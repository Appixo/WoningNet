// Ray-casting point-in-polygon. Points and vertices are [lat, lon] pairs, the
// order Google Maps shows them in, so an area can be pasted straight from a map.
export function pointInPolygon([lat, lon], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const crosses = lonI > lon !== lonJ > lon;
    if (crosses && lat < ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI) inside = !inside;
  }
  return inside;
}
