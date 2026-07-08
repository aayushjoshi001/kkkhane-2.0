-- Create departments table
CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add department_id to users
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

-- Enable RLS on departments
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- Departments are viewable by all staff in the same restaurant
CREATE POLICY "staff_read_departments" ON public.departments
    FOR SELECT 
    USING (restaurant_id = current_restaurant_id());

-- Departments are manageable (insert, update, delete) by managers and admins
CREATE POLICY "admin_manage_departments" ON public.departments
    FOR ALL
    USING (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin'])) AND 
        (restaurant_id = current_restaurant_id())
    )
    WITH CHECK (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin'])) AND 
        (restaurant_id = current_restaurant_id())
    );
