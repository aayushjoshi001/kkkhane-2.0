-- Storage RLS policies for the `menu-images` bucket.
-- The bucket existed (public) but had no policies, so authenticated admins could not
-- upload item / variation photos via the browser client. Mirrors the menu-pdfs policies.

create policy "Public Read Access menu-images"
    on storage.objects for select
    using (bucket_id = 'menu-images');

create policy "Admin Insert menu-images"
    on storage.objects for insert
    with check (bucket_id = 'menu-images' and auth.role() = 'authenticated');

create policy "Admin Update menu-images"
    on storage.objects for update
    using (bucket_id = 'menu-images' and auth.role() = 'authenticated');

create policy "Admin Delete menu-images"
    on storage.objects for delete
    using (bucket_id = 'menu-images' and auth.role() = 'authenticated');
