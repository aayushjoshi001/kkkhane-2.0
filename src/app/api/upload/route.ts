import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, getOptionalUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/ratelimit'

const ALLOWED_IMAGE_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/avif',  // iPhone / modern phone photos
    '',  // some browsers send an empty MIME type for HEIC — allow & let storage infer
]
const ALLOWED_VIDEO_TYPES = [
    'video/mp4', 'video/webm',
    'video/quicktime', 'video/x-quicktime',  // .mov from phones
    'video/x-m4v', 'video/3gpp',
    '',
]
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/webm']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024  // 10MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024 // 100MB
const MAX_AUDIO_BYTES = 5 * 1024 * 1024   // 5MB

export async function POST(req: NextRequest) {
    try {
        // Rate limit: 20 uploads per 10 minutes per IP
        const rateLimitError = await checkRateLimit('UPLOAD', 20, 600)
        if (rateLimitError) {
            return NextResponse.json({ error: rateLimitError }, { status: 429 })
        }

        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const type = formData.get('type') as string | null
        const folder = (formData.get('folder') as string | null) || 'homepage'

        // Avatars are user-owned, not tenant data — allow uploading one before a
        // restaurant exists yet (e.g. mid-onboarding). Every other folder keeps
        // the original restaurant-scoped auth requirement unchanged.
        const isAvatarUpload = folder === 'avatars'

        let user: Awaited<ReturnType<typeof getCurrentUser>>
        if (isAvatarUpload) {
            const optionalUser = await getOptionalUser()
            if (!optionalUser) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            user = optionalUser
        } else {
            try {
                user = await getCurrentUser()
            } catch {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        if (!file || file.size === 0) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        }

        if (type !== 'image' && type !== 'video' && type !== 'audio') {
            return NextResponse.json({ error: 'Invalid upload type. Must be "image", "video", or "audio".' }, { status: 400 })
        }

        // Validate MIME type and size
        if (type === 'image') {
            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                return NextResponse.json({ error: 'Invalid image type. Allowed: JPEG, PNG, WebP, GIF.' }, { status: 400 })
            }
            if (file.size > MAX_IMAGE_BYTES) {
                return NextResponse.json({ error: 'Image exceeds 10MB limit.' }, { status: 400 })
            }
        } else if (type === 'video') {
            if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
                return NextResponse.json({ error: 'Invalid video type. Allowed: MP4, WebM.' }, { status: 400 })
            }
            if (file.size > MAX_VIDEO_BYTES) {
                return NextResponse.json({ error: 'Video exceeds 100MB limit.' }, { status: 400 })
            }
        } else {
            if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
                return NextResponse.json({ error: 'Invalid audio type. Allowed: MP3, WAV, OGG.' }, { status: 400 })
            }
            if (file.size > MAX_AUDIO_BYTES) {
                return NextResponse.json({ error: 'Audio exceeds 5MB limit.' }, { status: 400 })
            }
        }

        const defaultExt = type === 'image' ? 'jpg' : type === 'audio' ? 'mp3' : 'mp4'
        const ext = file.name.split('.').pop()?.toLowerCase() || defaultExt
        const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '')
        const path = isAvatarUpload
            ? `${safeFolder}/${user.id}/${Date.now()}.${ext}`
            : `${safeFolder}/${user.restaurantId}/${Date.now()}.${ext}`

        // Fall back to a sane content type when the browser reports none (common for HEIC)
        const extMime: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
            gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
            mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
            mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
        }
        const contentType = file.type || extMime[ext] || 'application/octet-stream'

        const supabase = await createAdminClient()

        // Convert File → ArrayBuffer so Node.js Supabase client handles it correctly
        const arrayBuffer = await file.arrayBuffer()

        const { data, error } = await supabase.storage
            .from('uploads')
            .upload(path, arrayBuffer, {
                contentType,
                upsert: true,  // allow re-upload if same path somehow collides
            })

        if (error || !data) {
            console.error('Storage upload error:', error)
            return NextResponse.json(
                { error: error?.message || 'Upload failed. Please check the storage bucket exists.' },
                { status: 500 }
            )
        }

        const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path)

        return NextResponse.json({ url: publicUrl }, { status: 200 })
    } catch (err) {
        console.error('Upload route error:', err)
        const message = err instanceof Error ? err.message : 'Upload failed'
        // Body too large (Vercel serverless caps request bodies at ~4.5MB).
        if (/body|payload|413|too large|limit/i.test(message)) {
            return NextResponse.json(
                { error: 'File too large to upload here (max ~4.5MB on the server). For large videos, paste a hosted URL instead.' },
                { status: 413 }
            )
        }
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
