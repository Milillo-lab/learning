# Local incidence angle and terrain effects: `sar-local-incidence/`

Interactive module for CIVE 6359 that goes with *SAR, Explained* #3, "Local incidence angle: when the ground is not flat"
(scenes 5 to 7, 1:48 to 2:23: why facing slopes look brighter, the slant-range squeeze, layover and shadow).

```bash
cd learning && python3 -m http.server 8000
# open http://localhost:8000/sar-local-incidence/
```

It must be served over HTTP: the page reads heights and values from PNG pixels.

## The three parts

1. **Cross-section**: one 1 km slope seen along the track from behind the satellite (the series convention: NISAR looks
   left, so the satellite is on the right; Sentinel-1 looks right, satellite on the left). Controls: incidence angle,
   slope, the compass direction the slope faces (with shortcuts toward / away / along the track), look side, pass.
   Readouts: local incidence angle, brightness relative to level ground (scattering and squeeze parts), image area per
   unit of slope area, tilt in the range plane, layover and shadow. A strip shows the radar image of the line, binned by
   slant range. A map view shows the pass, the look direction and the slope.
2. **Panamint Range, real data**: NISAR GSLC (before terrain correction) and GCOV γ0 (after), local incidence, height and
   a simulated layer, compared with a draggable divider; a live facing-vs-away measurement and a chart of median
   brightness by local incidence; the Sentinel-1C image of the same ridge (right-looking, lights the other side).
3. **Simulator**: the same model on every cell of six elevation models (Copernicus GLO-30 for all, USGS 3DEP 10 m for
   the five in the US): local incidence, layover and shadow (self and cast), brightness on the map and in radar geometry,
   optional 4-look speckle.

The address can carry a set-up, for slides or a quiz:
`#inc=30&slope=45&dir=toward&look=right&pass=desc&site=rainier&dem=3dep&view=mask&speckle=1&theme=light`.

## The model (all in `app.js`, top comment)

- Flat Earth, parallel rays. Headings 344.5° ascending (from the NISAR GCOV line-of-sight vector over the Panamint
  Range) and 195.5° descending (mirrored); the bearing to the satellite is heading + 90° (left-looking) or − 90° (right).
- cos θloc = n·l; image-plane projection n·p (Ulander 1996), which is sin θloc for a slope tilted in range (Small 2011,
  eq. 5); layover where n·p ≤ 0, shadow where n·l ≤ 0 or terrain nearer the satellite blocks the ray.
- Brightness relative to level ground = [cos²θloc / cos²θ] × [sin θ / n·p] (Lambert, Richards 2009 eq. 5.5b, p. 140).
  A teaching model: no noise floor, no antenna pattern, no volume or double-bounce scattering.
- Radar geometry in part 3: each azimuth line is sampled every half cell and the echoes are binned by slant range,
  so foreshortening and layover come out of the binning; the map image looks each cell up in that radar image.

## Numbers checked against the SAR #3 script (26 Nov 2026)

| Script | Page |
|---|---|
| 40° incidence, 20° slope: 20° facing, 60° away, about 44° along track | 20.0°, 60.0°, 44.0° |
| 0.34 / 0.64 / 0.87 km of slant range per km of slope | 0.34, 0.64, 0.87 (along track: 0.60, the area ratio) |
| layover past θ, shadow past 90° − θ (50° at 40°) | banner and strip switch at 40.0° and 50.0° |
| Panamint, facing minus away: 10.7 dB before, 1.0 dB after | `build_data.py` reproduces 10.72 and 1.01 on the 10 m grid and asserts them; the page's live 40 m version gives about 10.5 and 1.0 |
| GCOV medians by local incidence (data/scene9_check.json) | reproduced exactly as medians of dB (the JSON key says "mean"; the values are medians) |

The local incidence angle built here from the Copernicus DEM and the NISAR line-of-sight vector matches the Video
Office's `local_incidence_on_gcov_grid.npy` (median difference 0.000°).

## Data (`data/`, 6.5 MB) and how it was built

`build/build_data.py` writes everything. Elevation tiles are precomputed because the Copernicus DEM bucket on AWS sends
no CORS header (checked 26 Nov 2026), so a browser cannot read it from GitHub Pages; 3DEP does allow CORS, but its
tiles are 450 MB GeoTIFFs. The NISAR and Sentinel-1 crops come from the SAR #3 project folder
(`MyEditorialAssistant/projects/sar-series/v03-local-incidence/data/`, downloaded by the Video Office on 26 Nov 2026)
and are not in this repo; only the derived images are.

## Credits

NISAR L2 GSLC and GCOV (provisional), track 106, frame 20, 19 Oct 2026: NASA/JPL-Caltech and ISRO, via the ASF DAAC.
Contains modified Copernicus Sentinel data (2026). Copernicus DEM GLO-30, © DLR e.V. 2010–2014 and © Airbus Defence
and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. USGS 3DEP,
public domain.
