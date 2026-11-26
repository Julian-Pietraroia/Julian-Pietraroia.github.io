/* Real filament colours, from the makers' own published hex codes unless noted.
 * Bambu Lab: hex code tables on each product page at us.store.bambulab.com
 * Overture: "Overture Hex Code List" PDF (overture3d.com)
 * Polymaker: black from shop.polymaker.com, white from MatterHackers' listing, orange measured by filamentcolors.xyz
 * Colours whose hex pairing was unclear in the source, or glow/luminous colours, are left out.
 */
(function (root) {
  const LINES = [
    { id: 'bambu-tpu95', brand: 'Bambu Lab', name: 'TPU 95A HF', type: 'tpu', url: 'https://us.store.bambulab.com/products/tpu-95a-hf',
      colours: { White: '#FFFFFF', Yellow: '#F3E600', Blue: '#0072CE', Red: '#C8102E', Gray: '#898D8D', Black: '#101820' } },
    { id: 'overture-tpu', brand: 'Overture', name: 'TPU', type: 'tpu', url: 'https://overture3d.com',
      colours: { White: '#FFFFFF', Red: '#D7021C', Brown: '#A47C48', Yellow: '#FFDF03', 'Space Grey': '#90999D', Grey: '#E2E7E9', 'Bright Pink': '#FFBDD1', Orange: '#FFA11D', Black: '#000000', Green: '#00EB75', 'Digital Blue': '#0378D0', Blue: '#274E96', Purple: '#8B69CE', 'Neon Green': '#2EFF6D', 'Neon Orange': '#FA8E36', 'Neon Red': '#FF3F38', 'Light Green': '#A0FD62' } },
    { id: 'overture-hstpu', brand: 'Overture', name: 'High Speed TPU', type: 'tpu', url: 'https://overture3d.com',
      colours: { Orange: '#FF8B47', Black: '#000000', White: '#FFFFFF', 'Neon Yellow': '#FEF71D', 'Neon Magenta': '#FB23AF', 'Pastel Rose': '#F5D0B7', 'Translucent Blue': '#386DFF', 'Translucent Red': '#C00000', 'Translucent Purple': '#8014C8', 'Translucent Green': '#00E691', 'Translucent Orange': '#FA4616' } },
    { id: 'polymaker-polyflex', brand: 'Polymaker', name: 'PolyFlex TPU95', type: 'tpu', url: 'https://shop.polymaker.com/products/polyflex-tpu95',
      colours: { Black: '#16161A', White: '#FFFFFF', Orange: '#D46E1C' } },
    { id: 'bambu-tpuams', brand: 'Bambu Lab', name: 'TPU for AMS', type: 'tpuams', url: 'https://us.store.bambulab.com/products/tpu-for-ams',
      colours: { Red: '#ED0000', Yellow: '#F9EF41', Blue: '#5898DD', 'Neon Green': '#90FF1A', White: '#FFFFFF', Gray: '#939393', Black: '#000000' } },
    { id: 'bambu-pla', brand: 'Bambu Lab', name: 'PLA Basic', type: 'pla', url: 'https://us.store.bambulab.com/products/pla-basic-filament',
      colours: { 'Jade White': '#FFFFFF', Beige: '#F7E6DE', Gold: '#E4BD68', Silver: '#A6A9AA', Gray: '#8E9089', Bronze: '#847D48', Brown: '#9D432C', Red: '#C12E1F', Magenta: '#EC008C', Pink: '#F55A74', Orange: '#FF6A13', Yellow: '#F4EE2A', 'Bambu Green': '#00AE42', 'Mistletoe Green': '#3F8E43', Cyan: '#0086D6', Blue: '#0A2989', Purple: '#5E43B7', 'Blue Gray': '#5B6579', 'Light Gray': '#D1D3D5', 'Dark Gray': '#545454', Black: '#000000' } },
    { id: 'bambu-petg', brand: 'Bambu Lab', name: 'PETG HF', type: 'petg', url: 'https://us.store.bambulab.com/products/petg-hf',
      colours: { Yellow: '#FFD00B', Orange: '#F75403', Green: '#00AE42', Red: '#EB3A3A', Blue: '#002E96', Black: '#000000', White: '#FFFFFF', Cream: '#F9DFB9', 'Lime Green': '#6EE53C', 'Forest Green': '#39541A', 'Lake Blue': '#1F79E5', 'Peanut Brown': '#875718', Gray: '#ADB1B2', 'Dark Gray': '#515151' } },
  ];
  const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  function lab(c) {
    const [r, g, b] = c.map(lin);
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  // CIEDE2000 colour difference
  function dE(c1, c2) {
    const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2), rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const h = (a, b) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
    const h1p = h(a1p, b1), h2p = h(a2p, b2);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = C1p * C2p === 0 ? 0 : h2p - h1p; if (dhp > 180) dhp -= 360; if (dhp < -180) dhp += 360;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
    const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
    let hpm = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hpm += h1p + h2p < 360 ? 360 : -360; hpm /= 2; }
    const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
    const Sl = 1 + 0.015 * (Lpm - 50) ** 2 / Math.sqrt(20 + (Lpm - 50) ** 2), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
    const Rt = -2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hpm - 275) / 25) ** 2)) * rad);
    return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
  }
  // best matches for an RGB colour among lines of one filament type, nearest first
  function match(rgb, type, brand) {
    const out = [];
    for (const L of LINES) {
      if (L.type !== type || (brand && L.brand !== brand)) continue;
      for (const [name, hex] of Object.entries(L.colours)) out.push({ line: L, name, hex, d: dE(rgb, hex2rgb(hex)) });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  const quality = d => d < 6 ? 'Very close' : d < 12 ? 'Close' : d < 22 ? 'Nearest available' : 'Rough match';
  const brands = type => [...new Set(LINES.filter(l => l.type === type).map(l => l.brand))];
  const api = { LINES, match, quality, brands, dE, hex2rgb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Filaments = api;
})(typeof window !== 'undefined' ? window : globalThis);
