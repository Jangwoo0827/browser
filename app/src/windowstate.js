// Decide whether saved window bounds are still usable (a monitor may have been unplugged, the size may be tiny).
function fitBounds(saved, workAreas, min = { width: 720, height: 480 }) {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;
  const width = Math.max(Math.round(saved.width), min.width);
  const height = Math.max(Math.round(saved.height), min.height);
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width, height };
  // the title bar must stay reachable: a strip of the top edge has to lie on some display
  const reachable = workAreas.some((a) => {
    const overlap = Math.min(saved.x + width, a.x + a.width) - Math.max(saved.x, a.x);
    return overlap >= 120 && saved.y >= a.y - 8 && saved.y <= a.y + a.height - 40;
  });
  return reachable ? { x: Math.round(saved.x), y: Math.round(saved.y), width, height } : { width, height };
}

module.exports = { fitBounds };
