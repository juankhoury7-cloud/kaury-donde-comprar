# Kaury · Dónde comprar

Mapa público de las tiendas online que venden Kaury por unidad. El buscador lleva directo
al artículo en la tienda, con el color y talle que hay en stock.

- **Mapa público:** `/`
- **Panel de datos (con contraseña):** `/panel/`

## Cómo funciona

| Parte | Dónde corre | Qué hace |
|---|---|---|
| `scraper/` | GitHub Actions, cada 5 min | Lee el stock de cada tienda y lo sube a `/api/ingest`. Una vez por hora revisa también qué artículos publica cada tienda. |
| `functions/` | Cloudflare Pages | `/api/stock` (stock actual), `/api/ev` (búsquedas y clics anónimos), `/api/admin/events` (panel). |
| `site/` | Cloudflare Pages | Página ya armada. Se regenera con `npm run build`. |
| D1 | Cloudflare | Base de datos `DB`: tablas `kv` (stock) y `ev` (eventos). Se crean solas. |

El mapa pide el stock al abrir y cada 5 minutos. Si una tienda no responde, se mantiene su último dato bueno.

## Configuración

Cloudflare Pages (proyecto conectado a este repo):
- Build command: *(vacío)* · Output directory: `site`
- Variables (Settings → Variables and Secrets): `INGEST_TOKEN`, `PANEL_PASSWORD` (como *Secret*)
- Bindings: D1 database con nombre de variable `DB`

GitHub (Settings → Secrets and variables → Actions):
- Secret `INGEST_TOKEN` (la misma que en Cloudflare)
- Variable `SITE_URL` (opcional; por defecto `https://kaury-donde-comprar.pages.dev`)

## Cambiar tiendas o catálogo

- `data/stores.json` — locales del mapa · `data/shops.json` — de dónde se leen los artículos de cada tienda
- `data/catalog.json`, `data/sizes.json` — catálogo Kaury
- Después de editar: `npm run build` y subir los cambios.

Prueba local: `npm test` · `OUT=out.json node scraper/run.mjs` (no sube nada sin `SITE_URL` e `INGEST_TOKEN`).

## Protección contra saturación

| Dónde | Límite |
|---|---|
| `/api/stock` | Se guarda 30 s en memoria (no lee la base en cada visita) · 30 pedidos/min por IP |
| `/api/ev` | Solo desde la propia página (Origin) · 6 envíos y 60 eventos/min por IP · 400/día por IP · tope global `MAX_EV_DAY` (5.000/día por defecto) · eventos de más de 13 meses se borran solos |
| `/api/admin/events` | 8 contraseñas erróneas en 15 min → bloqueo 15 min · 20 pedidos/min · hasta 20.000 eventos por consulta |
| `/api/ingest` | Clave secreta · 6 pedidos/min |
| Navegador | Pide stock cada ~5 min solo con la pestaña visible, sin pedidos superpuestos · una búsqueda cuenta recién cuando se dejan de tocar filtros 3 s · eventos en lotes cada 20 s · máx. 40 eventos por visita |

Si se agotara el cupo gratuito de Functions, Cloudflare sigue sirviendo la página (modo *fail open*): el mapa funciona con el último stock incluido en la página.
