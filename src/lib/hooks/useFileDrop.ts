'use client'

import { useCallback, useRef, useState } from 'react'

interface FileDropOptions {
    /** Ignore drops — e.g. while an upload is already in flight. */
    disabled?: boolean
}

/** True only when the drag actually carries files, not selected text or a link. */
function draggingFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files')
}

/**
 * Drag-and-drop target for a single file. Spread `dropProps` onto the zone and
 * style it off `isOver`.
 *
 * Note that `accept` on a file input does NOT apply to drops, so a zone using
 * this can receive any file — a PDF, a 40MB RAW, a folder. Callers must
 * validate what they get rather than trusting the picker's filter.
 */
export function useFileDrop(onFile: (file: File) => void, { disabled = false }: FileDropOptions = {}) {
    const [isOver, setIsOver] = useState(false)
    // dragenter/dragleave also fire as the pointer crosses the zone's own
    // children, so a plain boolean flickers off mid-hover whenever the cursor
    // passes over the icon or label inside. Counting enters against leaves
    // means `isOver` only clears once the pointer has left the zone itself.
    const depth = useRef(0)

    const onDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled || !draggingFiles(e)) return
        depth.current += 1
        setIsOver(true)
    }, [disabled])

    // Without a cancelled dragover the browser treats the drop as navigation and
    // replaces the page with the dropped image.
    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled || !draggingFiles(e)) return
        e.dataTransfer.dropEffect = 'copy'
    }, [disabled])

    const onDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setIsOver(false)
    }, [disabled])

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        depth.current = 0
        setIsOver(false)
        if (disabled) return
        const file = e.dataTransfer.files?.[0]
        if (file) onFile(file)
    }, [disabled, onFile])

    return { isOver, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
