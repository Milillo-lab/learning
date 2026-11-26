"""Build the data files of the "Local incidence angle and terrain effects" module.

Run from anywhere:  python3 build_data.py
Needs rasterio, numpy, Pillow and network access to two public S3 buckets (Copernicus GLO-30 and USGS 3DEP).
The Panamint NISAR and Sentinel-1 crops are read from the SAR #3 project folder (DATA below), which the Video Office
downloaded on 26 Nov 2026 with Pietro's yes; they are not in this repo, only the small derived images are.

Why precomputed: the Copernicus DEM bucket sends no CORS header (checked 26 Nov 2026), so a browser on
milillo-lab.github.io cannot read it directly. 3DEP does send "Access-Control-Allow-Origin: *", but its tiles are
450 MB GeoTIFFs; precomputed 16-bit PNG tiles keep the page fast and offline-friendly.

Outputs in ../data/:
  dem_<site>_<src>.png   height as 16 bits in R (high byte) and G (low byte), scaled between min and max in sites.json
  sites.json             one entry per tile: grid size, pixel spacing, height range, credit
  panamint_gslc.webp, panamint_gcov.webp   NISAR HH, 20 m display images, same dB stretch (-17 to 9 dB)
  panamint_s1.webp       Sentinel-1C VV amplitude, radar geometry flipped so north is up (approximate)
  panamint_vals.png      40 m: R = GSLC dB, G = GCOV dB (q = round((dB+30)*4)+1, 0 = no data), B = local incidence (deg)
  panamint_aux.png       40 m: R = terrain slope (deg), G = height high byte, B = height low byte (131.5 to 3356.9 m)
  panamint_meta.json     geometry and the numbers measured here, for the page
"""
import json, math, pathlib
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "data"
DATA = pathlib.Path.home() / "Documents/sw/AI/MyEditorialAssistant/projects/sar-series/v03-local-incidence/data"
OUT.mkdir(exist_ok=True)

COP = "Copernicus DEM GLO-30, © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA"
TDEP = "USGS 3D Elevation Program, 1/3 arc-second (about 10 m) seamless DEM, public domain"


def cop_tiles(w, s, e, n):
    out = []
    for la in range(math.floor(s), math.floor(n) + 1):
        for lo in range(math.floor(w), math.floor(e) + 1):
            ns = "N" if la >= 0 else "S"; ew = "E" if lo >= 0 else "W"
            nm = f"Copernicus_DSM_COG_10_{ns}{abs(la):02d}_00_{ew}{abs(lo):03d}_00_DEM"
            out.append(f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{nm}/{nm}.tif")
    return out


def dep_tiles(w, s, e, n):
    out = []
    for la in range(math.floor(s), math.floor(n) + 1):
        for lo in range(math.floor(w), math.floor(e) + 1):
            nm = f"n{la + 1:02d}w{abs(lo):03d}"          # 3DEP names a tile by its north-west corner
            out.append(f"/vsicurl/https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/{nm}/USGS_13_{nm}.tif")
    return out


def utm_epsg(lat, lon):
    z = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + z


def dem_on_grid(src, lat, lon, box_m, n, x0=None, y0=None, epsg=None):
    """Height on an n x n north-up UTM grid of side box_m centred on (lat, lon), bilinear."""
    epsg = epsg or utm_epsg(lat, lon)
    if x0 is None:
        from pyproj import Transformer
        cx, cy = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
        x0, y0 = cx - box_m / 2, cy + box_m / 2
    dx = box_m / n
    dlat = box_m / 2 / 111000 * 1.3; dlon = dlat / math.cos(math.radians(lat))
    bb = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
    urls = (cop_tiles if src == "cop30" else dep_tiles)(*bb)
    srcs = [rasterio.open(u) for u in urls]
    mosaic, tr = merge(srcs, bounds=bb)
    crs = srcs[0].crs
    for s in srcs: s.close()
    dst = np.full((n, n), np.nan, np.float32)
    reproject(mosaic[0].astype(np.float32), dst, src_transform=tr, src_crs=crs, src_nodata=-9999.0,
              dst_transform=from_origin(x0, y0, dx, dx), dst_crs=f"EPSG:{epsg}", dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    return dst, dx, epsg, (x0, y0)


def save16(z, path):
    lo, hi = float(np.nanmin(z)), float(np.nanmax(z))
    q = np.round((np.nan_to_num(z, nan=lo) - lo) / (hi - lo) * 65535).astype(np.uint32)
    rgb = np.zeros(z.shape + (3,), np.uint8); rgb[..., 0] = q >> 8; rgb[..., 1] = q & 255
    Image.fromarray(rgb).save(path, optimize=True)
    return lo, hi


# ------------------------------------------------------------------ DEM tiles for the simulator
SITES = [
    # key, name, lat, lon, box_m, n, sources, note
    ("panamint", "Panamint Range, west wall of Death Valley, California", 36.20, -117.05, 20000, 500, ["cop30", "3dep"],
     "the SAR #3 ridge; same 20 km square as the NISAR crop above"),
    ("rainier", "Mount Rainier, Washington", 46.853, -121.760, 16000, 500, ["cop30", "3dep"],
     "a steep volcano: layover and shadow at every incidence"),
    ("guadalupe", "Guadalupe Mountains escarpment, West Texas", 31.90, -104.82, 16000, 500, ["cop30", "3dep"],
     "a north-south escarpment in arid ground"),
    ("enchanted", "Enchanted Rock, central Texas", 30.5064, -98.8187, 5000, 500, ["3dep", "cop30"],
     "a small granite dome: every facing direction at once"),
    ("valleyridge", "Valley and Ridge, central Pennsylvania", 40.60, -77.50, 30000, 500, ["cop30", "3dep"],
     "long parallel ridges running north-east"),
    ("zagros", "Zagros fold belt, Iran", 29.50, 52.00, 30000, 500, ["cop30"],
     "parallel anticlines running north-west"),
]

meta = {}
for key, name, lat, lon, box, n, srcs, note in SITES:
    for src in srcs:
        if key == "panamint":
            # the GCOV grid of the NISAR crop (UTM 11N, x 485515 to 505505 m, y 3996135 to 4016125 m), at 40 m
            z, dx, epsg, (x0, y0) = dem_on_grid(src, lat, lon, 20000, 500, x0=485510.0, y0=4016130.0, epsg=32611)
        else:
            z, dx, epsg, (x0, y0) = dem_on_grid(src, lat, lon, box, n)
        bad = int(np.isnan(z).sum())
        f = f"dem_{key}_{src}.png"
        lo, hi = save16(z, OUT / f)
        meta[f"{key}_{src}"] = dict(site=key, name=name, note=note, src=src, file=f, w=n, h=n, dx=round(dx, 3),
                                    min=lo, max=hi, epsg=epsg, x0=x0, y0=y0, lat=lat, lon=lon,
                                    credit=COP if src == "cop30" else TDEP)
        print(f"{f}: {n}x{n} at {dx:.1f} m, {lo:.0f} to {hi:.0f} m, {bad} empty pixels")
json.dump(meta, open(OUT / "sites.json", "w"), indent=1)

# ------------------------------------------------------------------ Panamint real data
geo = json.load(open(DATA / "nisar_geometry_panamint.json"))
inc = geo["incidenceAngle"]; ex, ny = geo["losUnitVectorX"], geo["losUnitVectorY"]
up = math.sqrt(1 - ex * ex - ny * ny)
assert abs(math.degrees(math.acos(up)) - inc) < 0.05      # the LOS vector and the incidence angle agree

g = np.load(DATA / "nisar_gslc_power_2x2_panamint.npy").astype(np.float64)        # 1999 x 1999, 10 m
zc = np.load(DATA / "nisar_gcov_panamint.npz")
c = zc["gamma0_HHHH"][:1999, :1999].astype(np.float64)
dem = np.load(DATA / "cop30_dem_on_gcov_grid.npy")[:1999, :1999].astype(np.float64)
li_vo = np.load(DATA / "local_incidence_on_gcov_grid.npy")[:1999, :1999].astype(np.float64)
ok = np.isfinite(g) & np.isfinite(c) & (g > 0) & (c > 0)

# local incidence recomputed from the DEM and the LOS vector (rows go south, 10 m posting)
gy, gx = np.gradient(dem, 10.0)                # gy = dz/d(row) = -dz/dN
nE, nN, nU = -gx, gy, np.ones_like(dem); nn = np.sqrt(nE ** 2 + nN ** 2 + nU ** 2)
li = np.degrees(np.arccos(np.clip((nE * ex + nN * ny + nU * up) / nn, -1, 1)))
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
d_li = np.nanmedian(np.abs(li - li_vo))
print(f"local incidence: this build vs the Video Office file, median |difference| {d_li:.3f} deg")

dbg = 10 * np.log10(np.where(ok, g, 1)); dbc = 10 * np.log10(np.where(ok, c, 1))
okm = ok & (li > 5)
fac = okm & (slope >= 15) & (li <= inc - 10); awa = okm & (slope >= 15) & (li >= inc + 10)
FA_G = np.median(dbg[fac]) - np.median(dbg[awa]); FA_C = np.median(dbc[fac]) - np.median(dbc[awa])
print(f"10 m facing minus away: GSLC {FA_G:.2f} dB, GCOV {FA_C:.2f} dB (scene9_check.json: 10.7 and 1.0)")
assert round(FA_G, 1) == 10.7 and round(FA_C, 1) == 1.0

# 40 m blocks (4 x 4 of the 10 m grid): mean power over valid pixels, mean angle, mean slope, mean height
B = 4; N = 1996 // B
def blk(a, w=None):
    a = a[:N * B, :N * B].reshape(N, B, N, B)
    if w is None: return np.nanmean(a, axis=(1, 3))
    w = w[:N * B, :N * B].reshape(N, B, N, B)
    s = np.where(w, a, 0).sum(axis=(1, 3)); k = w.sum(axis=(1, 3))
    return np.where(k >= 8, s / np.maximum(k, 1), np.nan)
G4, C4 = blk(np.where(ok, g, 0), ok), blk(np.where(ok, c, 0), ok)
L4, S4, Z4 = blk(li), blk(slope), blk(dem)
q = lambda p: np.where(np.isfinite(p) & (p > 0), np.clip(np.round((10 * np.log10(np.where(p > 0, p, 1)) + 30) * 4) + 1, 1, 255), 0).astype(np.uint8)
vals = np.dstack([q(G4), q(C4), np.clip(np.round(L4), 0, 180).astype(np.uint8)])
Image.fromarray(vals).save(OUT / "panamint_vals.png", optimize=True)
zq = np.round((Z4 - 131.5) / (3356.9 - 131.5) * 65535).astype(np.uint32)
aux = np.dstack([np.clip(np.round(S4), 0, 90).astype(np.uint8), (zq >> 8).astype(np.uint8), (zq & 255).astype(np.uint8)])
Image.fromarray(aux).save(OUT / "panamint_aux.png", optimize=True)

# the same comparison on the 40 m blocks, as the page will compute it
ok4 = (vals[..., 0] > 0) & (vals[..., 1] > 0) & (L4 > 5)
f4 = ok4 & (S4 >= 15) & (L4 <= inc - 10); a4 = ok4 & (S4 >= 15) & (L4 >= inc + 10)
dq = lambda v: (v.astype(float) - 1) / 4 - 30
FA_G4 = np.median(dq(vals[..., 0][f4])) - np.median(dq(vals[..., 0][a4]))
FA_C4 = np.median(dq(vals[..., 1][f4])) - np.median(dq(vals[..., 1][a4]))
print(f"40 m facing minus away: GSLC {FA_G4:.2f} dB, GCOV {FA_C4:.2f} dB")

# display images, 20 m, same stretch as the Video Office preview (-17 to 9 dB)
def disp(p, path, lo=-17, hi=9):
    P = blk(np.where(ok, p, 0), ok) if False else None
    a = p[:1998, :1998].reshape(999, 2, 999, 2); w = ok[:1998, :1998].reshape(999, 2, 999, 2)
    m = np.where(w, a, 0).sum(axis=(1, 3)) / np.maximum(w.sum(axis=(1, 3)), 1)
    d = 10 * np.log10(np.where(m > 0, m, 1e-6))
    v = np.clip((d - lo) / (hi - lo), 0, 1) * 255
    Image.fromarray(v.astype(np.uint8)).save(path, quality=82, method=6)
disp(np.where(ok, g, 0), OUT / "panamint_gslc.webp"); disp(np.where(ok, c, 0), OUT / "panamint_gcov.webp")

s1 = np.load(DATA / "s1_vv_panamint.npy").astype(np.float64)[::-1]   # top row is south: flip for north up
d1 = 20 * np.log10(np.maximum(s1, 1)); lo1, hi1 = np.percentile(d1, [1, 99.5])
im = Image.fromarray((np.clip((d1 - lo1) / (hi1 - lo1), 0, 1) * 255).astype(np.uint8))
im.resize((1000, round(1000 * s1.shape[0] / s1.shape[1])), Image.LANCZOS).save(OUT / "panamint_s1.webp", quality=82, method=6)

bins = [(5, 20), (20, 30), (30, 40), (40, 50), (50, 60), (60, 85)]
med = {f"{a}-{b}": [round(float(np.median(dbg[okm & (li >= a) & (li < b)])), 1), round(float(np.median(dbc[okm & (li >= a) & (li < b)])), 1)] for a, b in bins}
# medians of dB: these reproduce data/scene9_check.json, whose key says "mean" but whose README says median
pm = dict(incidence=inc, los_en=[ex, ny], heading_deg=(math.degrees(math.atan2(ex, ny)) - 90) % 360,
          sat_bearing_deg=math.degrees(math.atan2(ex, ny)) % 360,
          facing_minus_away_10m=[round(float(FA_G), 1), round(float(FA_C), 1)],
          facing_minus_away_40m=[round(float(FA_G4), 1), round(float(FA_C4), 1)],
          median_dB_by_local_incidence_10m=med, grid=dict(epsg=32611, x0=485510.0, y0=4016130.0, dx=40.0, n=int(N)),
          s1_db_stretch=[round(float(lo1), 1), round(float(hi1), 1)])
json.dump(pm, open(OUT / "panamint_meta.json", "w"), indent=1)
print(json.dumps(pm, indent=1))
