-- Run once in the Supabase SQL Editor.
create table public.products (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 description text not null,
 category text not null,
 price_agorot integer not null check (price_agorot > 0),
 active boolean not null default true
);
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 product_id uuid not null references public.products(id),
 product_name text not null,
 quantity integer not null check (quantity between 1 and 20),
 unit_price_agorot integer not null check (unit_price_agorot > 0),
 customer_name text not null,
 customer_email text not null,
 created_at timestamptz not null default now()
);
alter table public.products enable row level security;
alter table public.orders enable row level security;
revoke all on public.products, public.orders from anon, authenticated;
grant select on public.products to anon, authenticated;
create policy "Active products are public" on public.products for select to anon, authenticated using (active);
-- Orders are visible only in the authenticated Supabase dashboard.
-- No public SELECT or INSERT policies: submissions use the validated function below.
create or replace function public.place_order(p_product_id uuid, p_quantity integer, p_name text, p_email text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare product public.products; saved public.orders;
begin
 if p_quantity is null or p_quantity not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;
 if p_name is null or length(trim(p_name)) not between 2 and 80 then raise exception 'INVALID_NAME'; end if;
 if p_email is null or length(trim(p_email)) > 254 or trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'INVALID_EMAIL'; end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
 select * into product from public.products where id=p_product_id and active;
 if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
 insert into public.orders(request_id,product_id,product_name,quantity,unit_price_agorot,customer_name,customer_email)
 values(p_request_id,product.id,product.name,p_quantity,product.price_agorot,trim(p_name),lower(trim(p_email)))
 on conflict(request_id) do nothing returning * into saved;
 if saved.id is null then
 select * into saved from public.orders where request_id=p_request_id;
 if saved.product_id <> p_product_id or saved.quantity <> p_quantity or saved.customer_name <> trim(p_name) or saved.customer_email <> lower(trim(p_email)) then raise exception 'REQUEST_CONFLICT'; end if;
 end if;
 return jsonb_build_object('id',saved.id,'total_agorot',saved.quantity*saved.unit_price_agorot);
end; $$;
revoke all on function public.place_order(uuid,integer,text,text,uuid) from public;
grant execute on function public.place_order(uuid,integer,text,text,uuid) to anon, authenticated;
insert into public.products(name,description,category,price_agorot) values
('מחברת נקודות','כריכה קשה, 160 עמודים ונייר נעים לכתיבה.','מחברות',4900),
('מחברת כיס','הרעיונות הטובים מגיעים גם כשאתם בדרך.','מחברות',2900),
('סט עטים שחורים','שלושה עטים דקים לכתיבה יומיומית חלקה.','כלי כתיבה',3500),
('עיפרון מכני','גוף מתכתי, אחיזה נוחה ועובי חוד 0.5 מ״מ.','כלי כתיבה',3900),
('פנקס משימות','מקום מסודר לדברים החשובים של היום.','תכנון',3200),
('לוח תכנון שבועי','כל השבוע במבט אחד, עם מקום גם לעצמך.','תכנון',5900);
