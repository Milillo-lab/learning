"""Builds the data files of the clouds-vs-radar page.

Usage: python3 -B build_data.py INPUT_DIR
INPUT_DIR holds city_stats.json, s2_city_scl.json and era5_tcc_2023_2025.nc. Coastlines come from the Natural Earth
1:50m shapefile in cartopy's local cache. Outputs, next to this script:
  cities.json          per-city statistics at the 10, 30 and 50% cloud limits (the 10% values must match city_stats.json)
  era5_tcc_2deg.bin    uint8, 13 layers x 90 rows x 180 columns: annual mean, then January to December. Rows run south to
                       north, columns from 179 W eastward. Value = fraction * 255.
  coast.bin            int16 pairs (lon*100, lat*100) from Natural Earth; a pair of 32767 ends a polyline
"""
import datetime as dt, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
IN = os.path.expanduser(sys.argv[1])
THRESHOLDS = (10, 30, 50)
REC_START, REC_END = dt.date(2023, 1, 1), dt.date(2025, 12, 31)


def stats(days, limit):
    """Same logic as city_stats() in tools/make_figs_post1_v2.py, with the limit as a parameter."""
    ds = sorted((dt.date.fromisoformat(k), v) for k, v in days.items())
    cl = [a for a, v in ds if v <= limit / 100]
    ends = [REC_START] + cl + [REC_END]
    gaps = [(b - a).days for a, b in zip(ends, ends[1:])]
    i = int(np.argmax(gaps))
    mon = np.zeros(12); tot = np.zeros(12)
    for a, v in ds:
        tot[a.month - 1] += 1; mon[a.month - 1] += v <= limit / 100
    assert tot.min() > 0
    return dict(clear=len(cl), pct=100 * len(cl) / max(len(ds), 1), per_year=len(cl) / 3, maxgap=max(gaps),
                gap_start=ends[i].isoformat(), gap_end=ends[i + 1].isoformat(), monthly=(100 * mon / tot).round(0).astype(int).tolist()), len(ds)


def build_cities():
    ref = {r["name"]: r for r in json.load(open(os.path.join(IN, "city_stats.json"), encoding="utf-8"))}
    scl = json.load(open(os.path.join(IN, "s2_city_scl.json"), encoding="utf-8"))["cities"]
    assert set(ref) == set(scl)
    out, scenes = [], 0
    for name, c in scl.items():
        s = {}
        for lim in THRESHOLDS:
            s[str(lim)], n = stats(c["days"], lim)
        r = ref[name]
        for k in ("clear", "maxgap", "gap_start", "gap_end"):
            assert s["10"][k] == r[k], (name, k)
        assert abs(s["10"]["pct"] - r["pct"]) < 1e-9 and abs(s["10"]["per_year"] - r["per_year"]) < 1e-9 and s["10"]["monthly"] == [int(v) for v in r["monthly"]] and n == r["n"], name
        for v in s.values():
            v["pct"] = round(v["pct"], 3); v["per_year"] = round(v["per_year"], 3)
        scenes += c["scenes"]
        out.append(dict(name=name, continent=c["continent"], lon=c["lon"], lat=c["lat"], n=n, stats=s))
    out.sort(key=lambda r: r["name"])
    doc = dict(thresholds=list(THRESHOLDS), record_start=REC_START.isoformat(), record_end=REC_END.isoformat(), scenes=scenes, cities=out)
    json.dump(doc, open(os.path.join(HERE, "cities.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("cities", len(out), "scenes", scenes)


def build_cloud():
    import xarray as xr
    ds = xr.open_dataset(os.path.join(IN, "era5_tcc_2023_2025.nc"))
    tcc = ds["tcc"].load()
    months = tcc["valid_time"].dt.month.values
    lat = ds["latitude"].values; lon = ds["longitude"].values
    lon180 = ((lon + 180) % 360) - 180
    ix = np.minimum(((lon180 + 180) // 2).astype(int), 179)
    iy = np.minimum(((lat + 90) // 2).astype(int), 89)
    w = np.cos(np.radians(lat)); w = np.maximum(w, 1e-4)  # area weight; keeps the pole rows defined

    def coarse(f):
        num = np.zeros((90, 180)); den = np.zeros((90, 180))
        wg = np.broadcast_to(w[:, None], f.shape)
        np.add.at(num, (iy[:, None].repeat(len(lon), 1), np.broadcast_to(ix, f.shape)), f * wg)
        np.add.at(den, (iy[:, None].repeat(len(lon), 1), np.broadcast_to(ix, f.shape)), wg)
        return num / den

    layers = [coarse(tcc.mean("valid_time").values)]
    for m in range(1, 13):
        layers.append(coarse(tcc.values[months == m].mean(axis=0)))
    arr = np.stack(layers)
    assert np.isfinite(arr).all()
    np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8).tofile(os.path.join(HERE, "era5_tcc_2deg.bin"))
    print("cloud", arr.shape, "annual range", arr[0].min(), arr[0].max(), "all", arr.min(), arr.max())


def build_coast(tol=0.05, min_len=0.5):
    import shapefile  # pyshp
    from shapely.geometry import LineString
    src = os.path.expanduser("~/.local/share/cartopy/shapefiles/natural_earth/physical/ne_50m_coastline.shp")
    rec, npts_in = [], 0
    for sh in shapefile.Reader(src).shapes():
        parts = list(sh.parts) + [len(sh.points)]
        for a, b in zip(parts, parts[1:]):
            npts_in += b - a
            ln = LineString(sh.points[a:b])
            if ln.length < min_len:
                continue
            ln = ln.simplify(tol, preserve_topology=False)
            if ln.is_empty or len(ln.coords) < 2:
                continue
            for x, y in ln.coords:
                rec += [round(x * 100), round(y * 100)]
            rec += [32767, 32767]
    np.array(rec, dtype=np.int16).tofile(os.path.join(HERE, "coast.bin"))
    print("coast points in", npts_in, "out", len(rec) // 2)


if __name__ == "__main__":
    build_cities(); build_cloud(); build_coast()
