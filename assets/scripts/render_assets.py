#!/usr/bin/env python3
"""Generate exact-dimension brand PNGs and SVG sources for The Rig ($RIG + $RGG)."""

from __future__ import annotations

import subprocess
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG_DIR = ROOT / "svg"
SVG_DIR.mkdir(parents=True, exist_ok=True)

FONT_DISPLAY = "Adwaita Sans, Noto Sans, Liberation Sans, sans-serif"
FONT_MONO = "JetBrainsMono NF, JetBrainsMono Nerd Font, Adwaita Mono, monospace"


def cube_mark_svg(cx: float, cy: float, scale: float, mint_first: bool = True) -> str:
    """Render an isometric twin-core cluster cube centered at (cx, cy)."""
    # Isometric hex vertices around origin with radius r = 100 * scale
    r = 100.0 * scale
    dx = 0.8660254 * r
    dy = 0.5 * r

    top = (cx, cy - r)
    tr = (cx + dx, cy - dy)
    br = (cx + dx, cy + dy)
    bot = (cx, cy + r)
    bl = (cx - dx, cy + dy)
    tl = (cx - dx, cy - dy)
    c = (cx, cy)

    # Inner core cube (54% radius)
    ir = r * 0.52
    idx = 0.8660254 * ir
    idy = 0.5 * ir
    itop = (cx, cy - ir)
    itr = (cx + idx, cy - idy)
    ibr = (cx + idx, cy + idy)
    ibot = (cx, cy + ir)
    ibl = (cx - idx, cy + idy)
    itl = (cx - idx, cy - idy)

    left_accent = "#00F59B" if mint_first else "#38BDF8"
    right_accent = "#38BDF8" if mint_first else "#00F59B"

    def pts(ps: list[tuple[float, float]]) -> str:
        return " ".join(f"{x:.2f},{y:.2f}" for x, y in ps)

    sw = max(2.0, 4.0 * scale)
    sw_inner = max(1.5, 2.8 * scale)
    node_r = max(3.0, 5.2 * scale)

    return f"""
  <g filter="url(#softGlow)">
    <!-- Outer Carbon Facets -->
    <polygon points="{pts([top, tr, c, tl])}" fill="#141926" stroke="#F3F5F8" stroke-opacity="0.16" stroke-width="{sw_inner:.1f}" />
    <polygon points="{pts([tl, c, bot, bl])}" fill="#0F131D" stroke="{left_accent}" stroke-opacity="0.55" stroke-width="{sw:.1f}" />
    <polygon points="{pts([c, tr, br, bot])}" fill="#111623" stroke="{right_accent}" stroke-opacity="0.55" stroke-width="{sw:.1f}" />

    <!-- Outer Isometric Wireframe -->
    <polygon points="{pts([top, tr, br, bot, bl, tl])}" fill="none" stroke="url(#twinGrad)" stroke-width="{sw:.1f}" stroke-linejoin="round" />

    <!-- Internal Twin-Bus Dividers -->
    <line x1="{top[0]:.2f}" y1="{top[1]:.2f}" x2="{c[0]:.2f}" y2="{c[1]:.2f}" stroke="#F3F5F8" stroke-opacity="0.45" stroke-width="{sw_inner:.1f}" />
    <line x1="{tl[0]:.2f}" y1="{tl[1]:.2f}" x2="{c[0]:.2f}" y2="{c[1]:.2f}" stroke="{left_accent}" stroke-width="{sw:.1f}" stroke-linecap="round" />
    <line x1="{tr[0]:.2f}" y1="{tr[1]:.2f}" x2="{c[0]:.2f}" y2="{c[1]:.2f}" stroke="{right_accent}" stroke-width="{sw:.1f}" stroke-linecap="round" />
    <line x1="{c[0]:.2f}" y1="{c[1]:.2f}" x2="{bot[0]:.2f}" y2="{bot[1]:.2f}" stroke="url(#vertGrad)" stroke-width="{sw:.1f}" stroke-linecap="round" />

    <!-- Inner Twin Core Cube -->
    <polygon points="{pts([itop, itr, c, itl])}" fill="#F3F5F8" fill-opacity="0.08" stroke="#F3F5F8" stroke-opacity="0.7" stroke-width="{sw_inner:.1f}" />
    <polygon points="{pts([itl, c, ibot, ibl])}" fill="{left_accent}" fill-opacity="0.22" stroke="{left_accent}" stroke-width="{sw_inner:.1f}" />
    <polygon points="{pts([c, itr, ibr, ibot])}" fill="{right_accent}" fill-opacity="0.22" stroke="{right_accent}" stroke-width="{sw_inner:.1f}" />

    <!-- Circuit Terminal Nodes -->
    <circle cx="{c[0]:.2f}" cy="{c[1]:.2f}" r="{node_r * 1.15:.2f}" fill="#F3F5F8" />
    <circle cx="{tl[0]:.2f}" cy="{tl[1]:.2f}" r="{node_r:.2f}" fill="{left_accent}" />
    <circle cx="{tr[0]:.2f}" cy="{tr[1]:.2f}" r="{node_r:.2f}" fill="{right_accent}" />
    <circle cx="{bot[0]:.2f}" cy="{bot[1]:.2f}" r="{node_r:.2f}" fill="#F3F5F8" />
  </g>"""


def shared_defs(width: int, height: int, primary_accent: str = "#00F59B") -> str:
    return f"""  <defs>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#181D2B" stroke-width="1"/>
    </pattern>
    <radialGradient id="ambientMint" cx="25%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#00F59B" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#090A0F" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ambientCyan" cx="80%" cy="65%" r="55%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#090A0F" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="twinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00F59B"/>
      <stop offset="50%" stop-color="#F3F5F8" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#38BDF8"/>
    </linearGradient>
    <linearGradient id="vertGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#F3F5F8"/>
      <stop offset="100%" stop-color="{primary_accent}"/>
    </linearGradient>
    <filter id="softGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="{primary_accent}" flood-opacity="0.22"/>
    </filter>
    <clipPath id="canvasClip">
      <rect width="{width}" height="{height}"/>
    </clipPath>
  </defs>"""


def build_avatar() -> str:
    w, h = 1024, 1024
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
{shared_defs(w, h, "#00F59B")}
  <g clip-path="url(#canvasClip)">
    <rect width="{w}" height="{h}" fill="#090A0F"/>
    <rect width="{w}" height="{h}" fill="url(#grid)"/>
    <rect width="{w}" height="{h}" fill="url(#ambientMint)"/>
    <rect width="{w}" height="{h}" fill="url(#ambientCyan)"/>

    <!-- Technical Calibration Frame -->
    <circle cx="512" cy="512" r="390" fill="none" stroke="#1E2536" stroke-width="2" stroke-dasharray="10 14"/>
    <circle cx="512" cy="512" r="340" fill="none" stroke="#151B28" stroke-width="1.5"/>

    <!-- Corner Reticles -->
    <path d="M 88 148 L 88 88 L 148 88" fill="none" stroke="#00F59B" stroke-opacity="0.45" stroke-width="3"/>
    <path d="M 876 88 L 936 88 L 936 148" fill="none" stroke="#38BDF8" stroke-opacity="0.45" stroke-width="3"/>
    <path d="M 88 876 L 88 936 L 148 936" fill="none" stroke="#38BDF8" stroke-opacity="0.45" stroke-width="3"/>
    <path d="M 876 936 L 936 936 L 936 876" fill="none" stroke="#00F59B" stroke-opacity="0.45" stroke-width="3"/>

    {cube_mark_svg(512, 488, 2.85, mint_first=True)}

    <!-- Minimal Bottom Telemetry Stamp -->
    <text x="512" y="886" text-anchor="middle" font-family="{FONT_MONO}" font-size="26" font-weight="600" letter-spacing="6" fill="#94A3B8">THE RIG // <tspan fill="#00F59B">$RIG</tspan> + <tspan fill="#38BDF8">$RGG</tspan></text>
  </g>
</svg>"""


def build_x_header() -> str:
    w, h = 1500, 500
    # Keep bottom-left clear (~240px) for X profile picture overlap
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
{shared_defs(w, h, "#00F59B")}
  <g clip-path="url(#canvasClip)">
    <rect width="{w}" height="{h}" fill="#090A0F"/>
    <rect width="{w}" height="{h}" fill="url(#grid)"/>
    <rect width="{w}" height="{h}" fill="url(#ambientMint)"/>
    <rect width="{w}" height="{h}" fill="url(#ambientCyan)"/>

    <!-- Top Status Line -->
    <rect x="64" y="44" width="1372" height="44" rx="6" fill="#12151E" stroke="#222A3D" stroke-width="1.5"/>
    <circle cx="92" cy="66" r="5" fill="#00F59B"/>
    <text x="112" y="72" font-family="{FONT_MONO}" font-size="16" font-weight="600" letter-spacing="1.6" fill="#00F59B">TWIN-CONTRACT GENESIS // BASE MAINNET (L2)</text>
    <text x="1410" y="72" text-anchor="end" font-family="{FONT_MONO}" font-size="15" fill="#94A3B8">@therigco · therig.co · HTTP 402 / x402 v2</text>

    <!-- Main Identity (shifted right of X avatar safe zone) -->
    <text x="320" y="190" font-family="{FONT_DISPLAY}" font-size="68" font-weight="700" letter-spacing="-2" fill="#F3F5F8">THE RIG</text>
    <text x="320" y="236" font-family="{FONT_DISPLAY}" font-size="26" font-weight="500" fill="#94A3B8">Separate the <tspan fill="#00F59B" font-weight="700">machine</tspan> from the <tspan fill="#38BDF8" font-weight="700">fuel</tspan> at Block 0.</text>

    <!-- Contract Pills -->
    <rect x="320" y="274" width="380" height="72" rx="8" fill="#12151E" stroke="#00F59B" stroke-opacity="0.55" stroke-width="1.5"/>
    <text x="340" y="302" font-family="{FONT_MONO}" font-size="14" font-weight="700" fill="#00F59B">01 // $RIG HARDWARE INDEX</text>
    <text x="340" y="328" font-family="{FONT_MONO}" font-size="16" fill="#F3F5F8">0xbfefd4d8...792315ba3</text>

    <rect x="724" y="274" width="380" height="72" rx="8" fill="#12151E" stroke="#38BDF8" stroke-opacity="0.55" stroke-width="1.5"/>
    <text x="744" y="302" font-family="{FONT_MONO}" font-size="14" font-weight="700" fill="#38BDF8">02 // $RGG EXECUTION GAS</text>
    <text x="744" y="328" font-family="{FONT_MONO}" font-size="16" fill="#F3F5F8">0x36376c70...fb2547cba3</text>

    <!-- Closed-Loop Value Flow Bar -->
    <rect x="320" y="372" width="784" height="58" rx="6" fill="#0D1018" stroke="#222A3D" stroke-width="1.2"/>
    <text x="344" y="407" font-family="{FONT_MONO}" font-size="15" font-weight="600" fill="#94A3B8">
      HTTP 402 INVOICE  →  <tspan fill="#38BDF8">$RGG GAS BURN</tspan>  →  <tspan fill="#00F59B">SPREAD SWEEP TO $RIG VAULT</tspan>
    </text>

    <!-- Right Isometric Emblem -->
    {cube_mark_svg(1290, 272, 1.45, mint_first=True)}
  </g>
</svg>"""


def build_dexscreener_banner(
    stamp: str,
    subtitle: str,
    full_ca: str,
    twin_note: str,
    accent: str,
    mint_first: bool,
) -> str:
    w, h = 1500, 500
    other_accent = "#38BDF8" if accent == "#00F59B" else "#00F59B"
    s_stamp = escape(stamp)
    s_subtitle = escape(subtitle)
    s_ca = escape(full_ca)
    s_twin = escape(twin_note)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
{shared_defs(w, h, accent)}
  <g clip-path="url(#canvasClip)">
    <rect width="{w}" height="{h}" fill="#090A0F"/>
    <rect width="{w}" height="{h}" fill="url(#grid)"/>
    <rect width="{w}" height="{h}" fill="url(#ambientMint)"/>
    <rect width="{w}" height="{h}" fill="url(#ambientCyan)"/>

    <!-- Left Accent Spine -->
    <rect x="0" y="0" width="10" height="{h}" fill="{accent}"/>

    <!-- Top Metadata Bar -->
    <rect x="64" y="46" width="1372" height="44" rx="6" fill="#12151E" stroke="{accent}" stroke-opacity="0.35" stroke-width="1.5"/>
    <circle cx="92" cy="68" r="5" fill="{accent}"/>
    <text x="112" y="74" font-family="{FONT_MONO}" font-size="16" font-weight="700" letter-spacing="1.5" fill="{accent}">THE RIG // BASE TWIN-GENESIS PRIMITIVE</text>
    <text x="1410" y="74" text-anchor="end" font-family="{FONT_MONO}" font-size="15" fill="#94A3B8">0% / 0% TAX · UNISWAP V4 · {s_twin}</text>

    <!-- Primary Stamp -->
    <text x="64" y="196" font-family="{FONT_DISPLAY}" font-size="60" font-weight="700" letter-spacing="-1.5" fill="#F3F5F8">{s_stamp}</text>
    <text x="64" y="246" font-family="{FONT_DISPLAY}" font-size="25" font-weight="500" fill="{accent}">{s_subtitle}</text>

    <!-- Full Contract Verification Panel -->
    <rect x="64" y="286" width="980" height="74" rx="8" fill="#12151E" stroke="{accent}" stroke-opacity="0.6" stroke-width="1.5"/>
    <text x="88" y="314" font-family="{FONT_MONO}" font-size="13" font-weight="700" letter-spacing="1.2" fill="#94A3B8">CANONICAL BASE CONTRACT ADDRESS</text>
    <text x="88" y="344" font-family="{FONT_MONO}" font-size="22" font-weight="600" fill="#F3F5F8">{s_ca}</text>

    <!-- Bottom Links / Twin Cross-Reference -->
    <rect x="64" y="384" width="980" height="54" rx="6" fill="#0D1018" stroke="{other_accent}" stroke-opacity="0.35" stroke-width="1.2"/>
    <text x="88" y="417" font-family="{FONT_MONO}" font-size="16" font-weight="600" fill="#F3F5F8">
      therig.co  ·  @therigco  ·  <tspan fill="{other_accent}">{s_twin}</tspan>
    </text>

    <!-- Right Isometric Cube Mark -->
    {cube_mark_svg(1275, 275, 1.55, mint_first=mint_first)}
  </g>
</svg>"""


def render_svg_to_png(svg_name: str, svg_content: str, png_name: str, width: int, height: int) -> None:
    svg_path = SVG_DIR / svg_name
    png_path = ROOT / png_name
    svg_path.write_text(svg_content, encoding="utf-8")
    subprocess.run(
        [
            "rsvg-convert",
            "--width",
            str(width),
            "--height",
            str(height),
            str(svg_path),
            "-o",
            str(png_path),
        ],
        check=True,
    )
    print(f"Rendered {png_path} ({width}x{height})")


def main() -> None:
    render_svg_to_png("avatar.svg", build_avatar(), "avatar-1024x1024.png", 1024, 1024)
    render_svg_to_png("x-header.svg", build_x_header(), "x-header-1500x500.png", 1500, 500)
    render_svg_to_png(
        "dexscreener-rig.svg",
        build_dexscreener_banner(
            stamp="01 // $RIG HARDWARE INDEX",
            subtitle="CAPITAL & RESERVE LAYER · ANCHOR TREASURY VAULT",
            full_ca="0xbfefd4d88899830d756b2678944770a792315ba3",
            twin_note="TWIN EXECUTION GAS: $RGG (0x3637...cba3)",
            accent="#00F59B",
            mint_first=True,
        ),
        "dexscreener-rig-1500x500.png",
        1500,
        500,
    )
    render_svg_to_png(
        "dexscreener-rgg.svg",
        build_dexscreener_banner(
            stamp="02 // $RGG EXECUTION GAS",
            subtitle="THROUGHPUT & SETTLEMENT LAYER · HTTP 402 / x402 v2",
            full_ca="0x36376c7058894685507eca5112d04cfb2547cba3",
            twin_note="TWIN RESERVE INDEX: $RIG (0xbfef...5ba3)",
            accent="#38BDF8",
            mint_first=False,
        ),
        "dexscreener-rgg-1500x500.png",
        1500,
        500,
    )


if __name__ == "__main__":
    main()
