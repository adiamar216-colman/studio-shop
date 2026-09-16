-- Additive migration: existing products and orders remain unchanged.
begin;
create table if not exists public.cart_orders (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 customer_name text not null,
 customer_email text not null,
 total_agorot integer not null check(total_agorot>0),
 request_items jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.cart_orders(id),
 product_id uuid not null references public.products(id),
 product_name text not null,
 quantity integer not null check(quantity between 1 and 20),
 unit_price_agorot integer not null check(unit_price_agorot>0),
 unique(order_id,product_id)
);
alter table public.cart_orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.cart_orders,public.order_items from anon,authenticated;
create or replace function public.place_cart_order(p_items jsonb,p_name text,p_email text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare canonical jsonb; saved public.cart_orders; row_item jsonb; product public.products; total integer:=0; snapshots jsonb:='[]'::jsonb; qty integer;
begin
 if p_name is null or length(trim(p_name)) not between 2 and 80 then raise exception 'INVALID_NAME'; end if;
 if p_email is null or length(trim(p_email))>254 or trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'INVALID_EMAIL'; end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'INVALID_CART'; end if;
 if jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_CART'; end if;
 for row_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(row_item)<>'object' or coalesce(row_item->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(row_item->>'quantity','') !~ '^([1-9]|1[0-9]|20)$' then raise exception 'INVALID_ITEM'; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer) order by (value->>'product_id')::uuid) into canonical from jsonb_array_elements(p_items);
 if (select count(distinct (value->>'product_id')::uuid) from jsonb_array_elements(canonical))<>jsonb_array_length(canonical) then raise exception 'DUPLICATE_PRODUCT'; end if;
 -- Serialize retries for the same request; unrelated orders are independent.
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into saved from public.cart_orders where request_id=p_request_id;
 if found then
  if saved.request_items<>canonical or saved.customer_name<>trim(p_name) or saved.customer_email<>lower(trim(p_email)) then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('id',saved.id,'total_agorot',saved.total_agorot);
 end if;
 for row_item in select value from jsonb_array_elements(canonical) loop
  select * into product from public.products where id=(row_item->>'product_id')::uuid and active for share;
  if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  qty:=(row_item->>'quantity')::integer;
  total:=total+product.price_agorot*qty;
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('product_id',product.id,'product_name',product.name,'quantity',qty,'unit_price_agorot',product.price_agorot));
 end loop;
 insert into public.cart_orders(request_id,customer_name,customer_email,total_agorot,request_items) values(p_request_id,trim(p_name),lower(trim(p_email)),total,canonical) returning * into saved;
 insert into public.order_items(order_id,product_id,product_name,quantity,unit_price_agorot)
 select saved.id,(x->>'product_id')::uuid,x->>'product_name',(x->>'quantity')::integer,(x->>'unit_price_agorot')::integer from jsonb_array_elements(snapshots) x;
 return jsonb_build_object('id',saved.id,'total_agorot',saved.total_agorot);
end; $$;
revoke all on function public.place_cart_order(jsonb,text,text,uuid) from public;
grant execute on function public.place_cart_order(jsonb,text,text,uuid) to anon,authenticated;
commit;
