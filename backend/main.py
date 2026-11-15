import heapq
import json
import numpy as np
import rasterio
import matplotlib.pyplot as plt
from PIL import Image
from rasterio.enums import Resampling
from matplotlib.colors import LightSource, rgb_to_hsv
from scipy.spatial import cKDTree

DTM = "/content/DTEEC_060707_2160_060773_2160_A01.IMG"
THEMIS_PNG = "/content/themis_day_colored.png"
DUST_PNG = "/content/dust_dci_dtm_extent_smooth.png"
START, GOAL = (2000, 500), (3000, 500)

SCALE = 0.001
START_HEADING_DEG = 0.0
DRIVE_PWM = 180
TURN_PWM = 150
WALK_SPEED_KMH = 2.0


def load_dtm(path, factor=4):
    with rasterio.open(path) as src:
        h, w = src.height // factor, src.width // factor
        z = src.read(1, out_shape=(h, w), resampling=Resampling.average, masked=True)
        res = src.res[0] * factor
    z = z.astype("float32").filled(np.nan)
    z[z < -1e10] = np.nan
    return z, res


def slope_deg(z, res):
    gy, gx = np.gradient(z, res)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def load_png(path, shape):
    im = Image.open(path).convert("RGBA").resize(shape[::-1], Image.BILINEAR)
    a = np.asarray(im, dtype="float32") / 255
    return a[..., :3], a[..., 3] > 0.5


def stretch(v, mask):
    lo, hi = np.nanpercentile(v[mask], [2, 98])
    return np.clip((v - lo) / (hi - lo + 1e-9), 0, 1)


def decode_themis(path, z, cmap="magma"):
    rgb, ok = load_png(path, z.shape)
    lut = plt.get_cmap(cmap)(np.linspace(0, 1, 256))[:, :3]
    _, idx = cKDTree(lut).query(rgb.reshape(-1, 3))
    v = (idx / 255).reshape(z.shape).astype("float32")
    v[~ok | np.isnan(z)] = np.nan
    return stretch(v, ~np.isnan(v))


def decode_dust(path, z):
    rgb, ok = load_png(path, z.shape)
    hue = rgb_to_hsv(rgb)[..., 0] * 360
    v = (1 - np.clip(hue, 0, 240) / 240).astype("float32")
    v[~ok | np.isnan(z)] = np.nan
    return stretch(v, ~np.isnan(v))


def cost_map(slope, dust, warm, max_slope=20, w_slope=10, w_dust=4, w_cold=2):
    dust = np.nan_to_num(dust, nan=np.nanmean(dust))
    warm = np.nan_to_num(warm, nan=np.nanmean(warm))
    cost = 1 + w_slope * (slope / max_slope) ** 2 + w_dust * dust + w_cold * (1 - warm)
    cost[(slope > max_slope) | np.isnan(slope)] = np.inf
    return cost


def astar(cost, start, goal):
    h, w = cost.shape
    moves = [(-1, 0, 1), (1, 0, 1), (0, -1, 1), (0, 1, 1),
             (-1, -1, 2**.5), (-1, 1, 2**.5), (1, -1, 2**.5), (1, 1, 2**.5)]
    heur = lambda r, c: np.hypot(r - goal[0], c - goal[1])
    g = np.full(cost.shape, np.inf)
    g[start] = 0
    came = {}
    open_ = [(heur(*start), start)]
    while open_:
        f, cur = heapq.heappop(open_)
        if cur == goal:
            path = [cur]
            while cur in came:
                cur = came[cur]
                path.append(cur)
            return path[::-1]
        if f - heur(*cur) > g[cur]:
            continue
        for dr, dc, d in moves:
            nr, nc = cur[0] + dr, cur[1] + dc
            if 0 <= nr < h and 0 <= nc < w and np.isfinite(cost[nr, nc]):
                ng = g[cur] + d * (cost[cur] + cost[nr, nc]) / 2
                if ng < g[nr, nc]:
                    g[nr, nc] = ng
                    came[(nr, nc)] = cur
                    heapq.heappush(open_, (ng + heur(nr, nc), (nr, nc)))
    return None


def line_cells(a, b):
    n = int(np.ceil(np.abs(np.subtract(b, a)).max())) + 1
    r = np.rint(np.linspace(a[0], b[0], n)).astype(int)
    c = np.rint(np.linspace(a[1], b[1], n)).astype(int)
    return r, c


def segment_cost(cost, a, b):
    r, c = line_cells(a, b)
    vals = cost[r, c]
    return np.inf if not np.isfinite(vals).all() else vals.mean() * np.hypot(*np.subtract(b, a))


def max_deviation(p, i, j):
    a, b = p[i].astype(float), p[j].astype(float)
    seg = p[i:j + 1] - a
    d = b - a
    n = np.hypot(*d)
    return 0.0 if n == 0 else np.abs(seg[:, 0] * d[1] - seg[:, 1] * d[0]).max() / n


def simplify(path, cost, tol=1.03, max_dev=2.5, max_seg=150):
    p = np.array(path)
    step = np.hypot(*np.diff(p, axis=0).T) * (cost[p[:-1, 0], p[:-1, 1]] + cost[p[1:, 0], p[1:, 1]]) / 2
    cum = np.concatenate([[0], np.cumsum(step)])
    out, i = [path[0]], 0
    while i < len(path) - 1:
        j = i + 1
        while (j + 1 < len(path) and j + 1 - i <= max_seg
               and max_deviation(p, i, j + 1) <= max_dev
               and segment_cost(cost, path[i], path[j + 1]) <= tol * (cum[j + 1] - cum[i])):
            j += 1
        out.append(path[j])
        i = j
    return out


def wrap(a):
    return (a + 180) % 360 - 180


def command(action, angle, heading, mars_m):
    return {"action": action, "angle_deg": round(float(angle), 1),
            "heading_deg": round(float(heading), 1),
            "mars_distance_m": round(float(mars_m), 1),
            "robot_distance_m": round(float(mars_m * SCALE), 3)}


def to_commands(waypoints, res):
    cmds, heading = [], START_HEADING_DEG
    for a, b in zip(waypoints[:-1], waypoints[1:]):
        dr, dc = b[0] - a[0], b[1] - a[1]
        target = np.degrees(np.arctan2(dc, -dr)) % 360
        turn = wrap(target - heading)
        if abs(turn) >= 0.5:
            cmds.append(command("turn", turn, target, 0))
        heading = target
        mars_m = np.hypot(dr, dc) * res
        cmds.append(command("forward", 0, target, mars_m))
    return cmds


def motor_step(speed, left_on, right_on, direction):
    return {"speed": int(speed), "left_on": int(left_on),
            "right_on": int(right_on), "direction": int(direction)}


def to_motor_commands(cmds):
    out = []
    for c in cmds:
        if c["action"] == "turn":
            right = c["angle_deg"] > 0
            out.append(motor_step(TURN_PWM, right, not right, 1))
        else:
            out.append(motor_step(DRIVE_PWM, 1, 1, 1))
        out.append(motor_step(0, 0, 0, 1))
    return out


def export_motor_json(motor_cmds, path="motor_commands.json"):
    with open(path, "w") as f:
        json.dump(motor_cmds, f, indent=1)
    return path


def path_stats(path, z, slope, res):
    p = np.array(path)
    r, c = p[:, 0], p[:, 1]
    steps = np.hypot(*np.diff(p, axis=0).T) * res
    dz = np.diff(z[r, c])
    return {"length_m": round(float(steps.sum()), 1),
            "climb_m": round(float(dz[dz > 0].sum()), 1),
            "max_slope_deg": round(float(slope[r, c].max()), 2)}


def route_summary(pts, slope, dust, warm, res, max_slope=20):
    r = np.array([p["row"] for p in pts])
    c = np.array([p["col"] for p in pts])
    e = np.array([p["elev"] for p in pts])
    flat = np.hypot(np.diff(r), np.diff(c)) * res
    dz = np.diff(e)
    dist = np.hypot(flat, dz)
    grade = np.divide(dz, flat, out=np.zeros_like(dz), where=flat > 0)
    speed_kmh = WALK_SPEED_KMH / 5 * 6 * np.exp(-3.5 * np.abs(grade + 0.05))
    hours = np.sum(dist / 1000 / speed_kmh)

    cell_risk = (0.6 * np.clip(slope[r, c] / max_slope, 0, 1)
                 + 0.25 * np.nan_to_num(dust[r, c], nan=0.5)
                 + 0.15 * (1 - np.nan_to_num(warm[r, c], nan=0.5)))
    risk = 1 + 9 * (0.5 * cell_risk.mean() + 0.5 * np.percentile(cell_risk, 95))

    return {"risk_index": round(float(risk), 1),
            "total_distance_m": round(float(dist.sum()), 1),
            "robot_distance_m": round(float(dist.sum() * SCALE), 3),
            "est_time_h": round(float(hours), 2),
            "est_time_hms": f"{int(hours)}h {int(hours * 60 % 60):02d}m",
            "walk_speed_kmh": WALK_SPEED_KMH}


def export_threejs(waypoints, cmds, z, res, slope, dust, warm, path="route_threejs.json"):
    h, w = z.shape
    pts = []
    for a, b in zip(waypoints[:-1], waypoints[1:]):
        r, c = line_cells(a, b)
        for rr, cc in zip(r, c):
            if np.isfinite(z[rr, cc]) and (not pts or pts[-1]["row"] != rr or pts[-1]["col"] != cc):
                pts.append({"row": int(rr), "col": int(cc),
                            "u": cc / (w - 1), "v": rr / (h - 1),
                            "x": (cc - (w - 1) / 2) * res, "z": (rr - (h - 1) / 2) * res,
                            "elev": float(z[rr, cc])})
    summary = route_summary(pts, slope, dust, warm, res)
    data = {"summary": summary,
            "grid": {"rows": h, "cols": w, "res_m": res,
                     "width_m": (w - 1) * res, "height_m": (h - 1) * res,
                     "elev_min": float(np.nanmin(z)), "elev_max": float(np.nanmax(z))},
            "robot": {"scale": SCALE, "start_heading_deg": START_HEADING_DEG},
            "waypoints": [{"row": int(r), "col": int(c),
                           "x": (c - (w - 1) / 2) * res, "z": (r - (h - 1) / 2) * res,
                           "elev": float(z[r, c])} for r, c in waypoints],
            "commands": cmds,
            "points": pts}
    with open(path, "w") as f:
        json.dump(data, f)
    print(summary)
    return path


def plot_route(z, path, waypoints):
    shade = LightSource(315, 45).hillshade(np.nan_to_num(z, nan=np.nanmean(z)))
    shade = np.ma.masked_where(np.isnan(z), shade)
    fig, ax = plt.subplots(figsize=(7, 14))
    ax.imshow(shade, cmap="gray")
    p, s = np.array(path), np.array(waypoints)
    ax.plot(p[:, 1], p[:, 0], "w-", lw=1, alpha=0.6, label="raw A*")
    ax.plot(s[:, 1], s[:, 0], "c-", lw=2.5, label="simplified")
    ax.plot(s[:, 1], s[:, 0], "co", ms=4)
    ax.plot(*s[0][::-1], "go", ms=9)
    ax.plot(*s[-1][::-1], "ro", ms=9)
    ax.set_title("Route on DTM (slope + dust + THEMIS)")
    ax.axis("off")
    ax.legend(loc="lower left")
    plt.show()


def main():
    z, res = load_dtm(DTM, factor=4)
    slope = slope_deg(z, res)
    dust = decode_dust(DUST_PNG, z)
    warm = decode_themis(THEMIS_PNG, z)
    cost = cost_map(slope, dust, warm)

    path = astar(cost, START, GOAL)
    if not path:
        print("no safe route")
        return
    waypoints = simplify(path, cost)
    cmds = to_commands(waypoints, res)
    motor_cmds = to_motor_commands(cmds)

    print(f"{z.shape} {res:.2f} m/cell")
    print(path_stats(path, z, slope, res))
    print(f"{len(path)} cells -> {len(waypoints)} waypoints -> {len(cmds)} commands")
    for m in motor_cmds:
        print(m)

    outs = [export_threejs(waypoints, cmds, z, res, slope, dust, warm),
            export_motor_json(motor_cmds)]
    plot_route(z, path, waypoints)
    try:
        from google.colab import files
        for o in outs:
            files.download(o)
    except ImportError:
        print("saved", outs)
    return motor_cmds


if __name__ == "__main__":
    motor_cmds = main()
