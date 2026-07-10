#!/usr/bin/env python3
"""Seed the Royal Restaurant tenant: profile, menu, and staff logins.

Idempotent: re-running matches existing rows by natural key (restaurant slug,
category name, item name, staff email) and updates rather than duplicating.

  python3 scripts/seed-royal-restaurant.py \
      --url https://<ref>.supabase.co --key <service_role_key> \
      --xlsx ~/Downloads/Royal_Restaurant_Categorized_Menu.xlsx [--dry-run]
"""
import argparse, json, re, secrets, string, sys, urllib.error, urllib.request, zipfile
import xml.etree.ElementTree as ET
from collections import OrderedDict

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
SLUG = 'royal-restaurant'
NAME = 'Royal Restaurant'
# Drinks poured at the bar route to the bar board; hot drinks come from the kitchen.
BAR_CATEGORIES = {'Bar (Hard Drinks)', 'Bar (Beer)', 'Beverages (Cold)'}
STAFF = [
    ('manager',   2, 'Royal Manager'),
    ('kitchen',   3, 'Royal Kitchen'),
    ('waiter',    4, 'Royal Waiter'),
    ('cashier',   6, 'Royal Cashier'),
    ('bartender', 7, 'Royal Bartender'),
]

# Rows provisionRestaurant() (src/lib/provisioning.ts) creates alongside the
# restaurant. The first cut of this script inserted `restaurants` directly and
# skipped these, leaving the tenant with no settings row (so features_v2 was
# absent and every feature flag read false) and zero dining tables (so the
# /t/<qr_token> customer flow had nothing to resolve). We seed them here instead.
# Keep in step with DEFAULT_THEME / DEFAULT_FEATURES_V1 / buildFeaturesV2 in
# src/lib/tiers.ts — this is Royal (business_type 'Restaurant' -> 'dine_in'), free tier.
THEME = {
    'primaryColor': '#FB6303', 'secondaryColor': '#1B263B',
    'fontFamily': 'Inter', 'borderRadius': '12px', 'menuLayout': 'grid',
}
FEATURES_V1 = {
    'tipsEnabled': True, 'feedbackEnabled': True,
    'geofenceEnabled': False, 'geofenceRadiusMeters': 100,
}
FEATURES_V2 = {
    'loyaltyEnabled': False, 'promosEnabled': True, 'takeoutEnabled': False,
    'multiLanguageEnabled': False, 'serviceRequestsEnabled': True,
    'splitBillingEnabled': True, 'dynamicPricingEnabled': False,
    'ingredientTrackingEnabled': False, 'staffShiftsEnabled': False,
    'waiterSessionEnabled': False, 'waiterOrderConfirmation': True,
    'dineInEnabled': True, 'quickServeItems': ['Water', 'Tissue'],
    'defaultTaxRate': 13, 'currency': 'NPR', 'currencySymbol': 'Rs.',
    'nepalPayEnabled': True, 'vatEnabled': False, 'phoneOtpEnabled': False,
    'bsDateEnabled': False, 'tipsEnabled': True, 'feedbackEnabled': True,
    'geofenceEnabled': False, 'geofenceRadiusMeters': 100,
    'selfOrderRequestEnabled': True,
}
TABLE_COUNT = 6


def parse_xlsx(path):
    z = zipfile.ZipFile(path)
    ns = {'m': NS[1:-1]}
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))

    def cell(c):
        v, isel = c.find('m:v', ns), c.find('m:is', ns)
        if isel is not None:
            return ''.join(x.text or '' for x in isel.iter(NS + 't'))
        if v is None:
            return ''
        return shared[int(v.text)] if c.get('t') == 's' else (v.text or '')

    rows = []
    for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).find('m:sheetData', ns):
        vals = {}
        for c in row.findall('m:c', ns):
            vals[re.match(r'[A-Z]+', c.get('r')).group()] = cell(c)
        rows.append(vals)
    return [r for r in rows if r.get('A') and r.get('B') and r.get('A') != 'Category']


def money(raw):
    """-> (price, orderable, note). 'Menu Rates'/'As per MRP' have no price."""
    raw = (raw or '').strip()
    m = re.match(r'^(\d+(?:\.\d+)?)', raw)
    if not m:
        return 0.0, False, raw            # 'As per MRP', 'Menu Rates'
    price = float(m.group(1))
    note = raw[m.end():].strip(' /')      # '70 / Pcs' -> 'Pcs'
    return price, True, note


class Api:
    def __init__(self, url, key, dry):
        self.url, self.key, self.dry = url.rstrip('/'), key, dry

    def _req(self, method, path, body=None, headers=None):
        h = {'apikey': self.key, 'Authorization': f'Bearer {self.key}',
             'Content-Type': 'application/json'}
        h.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f'{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}')

    def select(self, table, query):
        return self._req('GET', f'/rest/v1/{table}?{query}')

    def insert(self, table, rows, ret=True):
        if self.dry:
            print(f'  [dry-run] insert {len(rows)} -> {table}')
            return []
        return self._req('POST', f'/rest/v1/{table}', rows,
                         {'Prefer': 'return=representation' if ret else 'return=minimal'})

    def update(self, table, query, patch):
        if self.dry:
            print(f'  [dry-run] update {table}?{query}')
            return []
        return self._req('PATCH', f'/rest/v1/{table}?{query}', patch,
                         {'Prefer': 'return=representation'})

    def create_auth_user(self, email, password, full_name):
        if self.dry:
            print(f'  [dry-run] auth user {email}')
            return None
        return self._req('POST', '/auth/v1/admin/users', {
            'email': email, 'password': password, 'email_confirm': True,
            'user_metadata': {'full_name': full_name},
        })

    def find_auth_user(self, email):
        r = self._req('GET', f'/auth/v1/admin/users?filter={urllib.parse.quote(email)}')
        for u in (r or {}).get('users', []):
            if u.get('email', '').lower() == email.lower():
                return u
        return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--url', required=True)
    p.add_argument('--key', required=True)
    p.add_argument('--xlsx', required=True)
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args()
    api = Api(a.url, a.key, a.dry_run)

    rows = parse_xlsx(a.xlsx)
    print(f'parsed {len(rows)} menu rows')

    # ── restaurant ───────────────────────────────────────────────────────────
    existing = api.select('restaurants', f'slug=eq.{SLUG}&select=id,name')
    if existing:
        rid = existing[0]['id']
        print(f'restaurant exists: {rid}')
    else:
        rid = api.insert('restaurants', [{
            'name': NAME, 'slug': SLUG, 'business_type': 'Restaurant',
            'contact_email': 'info@royalrestaurant.com',
            'address': 'Kathmandu, Nepal', 'is_active': True,
        }])[0]['id'] if not a.dry_run else 'DRY'
        print(f'restaurant created: {rid}')

    # ── settings + tables (mirror provisionRestaurant, idempotent) ────────────
    if not api.select('settings', f'restaurant_id=eq.{rid}&select=restaurant_id'):
        api.insert('settings', [{
            'restaurant_id': rid, 'theme': THEME, 'features': FEATURES_V1,
            'features_v2': FEATURES_V2, 'business_hours': None,
        }], ret=False)
        print('settings: created')
    else:
        print('settings: already present')

    if not api.select('tables', f'restaurant_id=eq.{rid}&select=id&limit=1'):
        # qr_token generated here (url-safe) rather than via the DB default, matching
        # provisionRestaurant — the column default uses an encoding this PG rejects.
        api.insert('tables', [
            {'restaurant_id': rid, 'label': f'T{i}', 'qr_token': secrets.token_urlsafe(18)}
            for i in range(1, TABLE_COUNT + 1)
        ], ret=False)
        print(f'tables: created T1..T{TABLE_COUNT}')
    else:
        print('tables: already present')

    # ── categories (ordered as they appear in the sheet) ──────────────────────
    cats = OrderedDict()
    for r in rows:
        cats.setdefault(r['A'], []).append(r)

    have = {c['name']: c['id'] for c in
            (api.select('menu_categories', f'restaurant_id=eq.{rid}&select=id,name') or [])}
    cat_ids = {}
    new_cats = []
    for i, name in enumerate(cats):
        if name in have:
            cat_ids[name] = have[name]
        else:
            new_cats.append({'restaurant_id': rid, 'name': name, 'sort_order': i,
                             'station': 'bar' if name in BAR_CATEGORIES else 'kitchen'})
    for c in api.insert('menu_categories', new_cats) if new_cats else []:
        cat_ids[c['name']] = c['id']
    print(f'categories: {len(have)} existing, {len(new_cats)} created')

    # ── items (rows sharing a name inside a category are variations) ──────────
    have_items = {i['name']: i['id'] for i in
                  (api.select('menu_items', f'restaurant_id=eq.{rid}&select=id,name') or [])}
    created = skipped = var_count = 0
    for cname, items in cats.items():
        groups = OrderedDict()
        for r in items:
            groups.setdefault(r['B'], []).append(r)

        for iname, variants in groups.items():
            if iname in have_items:
                skipped += 1
                continue
            prices = [money(v.get('D')) for v in variants]
            base = min((p for p, ok, _ in prices if ok), default=0.0)
            orderable = any(ok for _, ok, _ in prices)
            notes = [n for _, ok, n in prices if n and not ok]
            unit = next((n for _, ok, n in prices if ok and n), '')
            desc = '; '.join(filter(None, [
                f'Priced {notes[0]}' if notes else '',
                f'Per {unit.lower()}' if unit else '',
            ])) or None

            item = {'restaurant_id': rid, 'category_id': cat_ids[cname], 'name': iname,
                    'price': base, 'is_available': orderable, 'description': desc,
                    'station': 'bar' if cname in BAR_CATEGORIES else None}
            if a.dry_run:
                created += 1
                continue
            new = api.insert('menu_items', [item])[0]
            created += 1
            if len(variants) > 1:
                vrows = []
                for v, (price, ok, _) in zip(variants, prices):
                    vrows.append({'menu_item_id': new['id'],
                                  'name': (v.get('C') or 'Standard').strip(),
                                  'price': price, 'is_available': ok})
                api.insert('menu_item_variations', vrows, ret=False)
                var_count += len(vrows)
    print(f'items: {created} created, {skipped} already present, {var_count} variations')

    # ── staff ────────────────────────────────────────────────────────────────
    alphabet = string.ascii_letters + string.digits
    creds, manager_id = [], None
    for local, role_id, full_name in STAFF:
        email = f'{local}@royalrestaurant.com'
        u = api.find_auth_user(email) if not a.dry_run else None
        if u:
            uid, pw = u['id'], '(existing, unchanged)'
        else:
            pw = ''.join(secrets.choice(alphabet) for _ in range(16))
            u = api.create_auth_user(email, pw, full_name)
            uid = u['id'] if u else 'DRY'
        if not a.dry_run:
            api.update('users', f'id=eq.{uid}',
                       {'restaurant_id': rid, 'role_id': role_id, 'full_name': full_name})
        if role_id == 2:
            manager_id = uid
        creds.append((email, pw))

    if manager_id and not a.dry_run:
        api.update('restaurants', f'id=eq.{rid}', {'owner_id': manager_id})

    print('\nstaff logins (store these now, passwords are not recoverable):')
    for email, pw in creds:
        print(f'  {email:<34} {pw}')
    print(f'\ndone. restaurant_id={rid}')


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (used by find_auth_user)
    main()
