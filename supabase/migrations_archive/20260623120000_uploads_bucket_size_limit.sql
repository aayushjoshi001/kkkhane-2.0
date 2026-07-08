-- Video upload fix: uploads now go DIRECT to Storage via signed URLs
-- (browser → Supabase Storage), bypassing the ~4.5MB serverless request-body cap
-- that broke video uploads routed through /api/upload. Because direct uploads are
-- client-driven, enforce a server-side ceiling on the bucket as defense-in-depth.
UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = 'uploads'; -- 100MB
