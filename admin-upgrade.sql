-- Run after setup.sql and cart-upgrade.sql. No existing orders are removed.
begin;
create table if not exists public.shop_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.shop_admins enable row level security;
revoke all on public.shop_admins from anon,authenticated;
create or replace function public.is_shop_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shop_admins where user_id=(select auth.uid()));
$$;
revoke all on function public.is_shop_admin() from public;
grant execute on function public.is_shop_admin() to authenticated;
alter table public.cart_orders add column if not exists status text not null default 'new' check(status in ('new','in_progress','completed'));
grant select on public.cart_orders,public.order_items to authenticated;
grant update(status) on public.cart_orders to authenticated;
create policy "Shop admins read orders" on public.cart_orders for select to authenticated using ((select public.is_shop_admin()));
create policy "Shop admins update status" on public.cart_orders for update to authenticated using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));
create policy "Shop admins read items" on public.order_items for select to authenticated using ((select public.is_shop_admin()));
commit;
-- Create a confirmed account in Authentication > Users > Add user.
-- Then run separately with the actual account email (never a password):
-- insert into public.shop_admins(user_id)
-- select id from auth.users where lower(email)=lower('YOUR_ADMIN_EMAIL') and email_confirmed_at is not null
-- on conflict do nothing;
