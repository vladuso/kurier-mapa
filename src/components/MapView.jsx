import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CITY } from "../lib/geodata.js";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const PALETTE = ["#2f6fb5", "#c2410c", "#2e8b57", "#8a4fbf", "#b5832a", "#0e7c86", "#c43d6b", "#5b6b2f"];

// stops: [{id, lat, lon, n, color, delivered, fixed}], route: [[lon,lat],...]
export default function MapView({ stops, route, start, selectedId, picking, onSelect, onPick, focus }) {
  const box = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  const startMarker = useRef(null);
  const pickRef = useRef(onPick);
  const pickingRef = useRef(picking);
  pickRef.current = onPick;
  pickingRef.current = picking;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current, style: STYLE,
      center: [CITY.center.lon, CITY.center.lat], zoom: 13.5, attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "top-right");
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: line([]) });
      m.addLayer({ id: "route", type: "line", source: "route",
        paint: { "line-color": "#d9661f", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.85 } });
      m.__ready = true;
      m.fire("kurier:ready");
    });
    m.on("click", (e) => { if (pickingRef.current) pickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }); });
    map.current = m;
    return () => m.remove();
  }, []);

  // trasa
  useEffect(() => {
    const m = map.current;
    const apply = () => m.getSource("route")?.setData(line(route));
    if (m.__ready) apply(); else m.once("kurier:ready", apply);
  }, [route]);

  // značky zastávok
  useEffect(() => {
    const m = map.current;
    const seen = new Set();
    for (const s of stops) {
      if (s.lat == null) continue;
      seen.add(s.id);
      let mk = markers.current.get(s.id);
      if (!mk) {
        const el = document.createElement("button");
        el.className = "pin";
        el.addEventListener("click", (ev) => { ev.stopPropagation(); if (!pickingRef.current) onSelect?.(el.dataset.id); });
        mk = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(m);
        markers.current.set(s.id, mk);
      }
      const el = mk.getElement();
      el.dataset.id = s.id;
      el.textContent = s.n;
      el.style.background = s.color;
      el.classList.toggle("dim", s.status && s.status !== "open");
      el.classList.toggle("sel", s.id === selectedId);
      el.classList.toggle("fixed", !!s.fixed);
      el.setAttribute("aria-label", `Zastávka ${s.n}: ${s.label}`);
      mk.setLngLat([s.lon, s.lat]);
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
  }, [stops, selectedId, onSelect]);

  // štart
  useEffect(() => {
    const m = map.current;
    if (!start) return;
    if (!startMarker.current) {
      const el = document.createElement("div");
      el.className = "start-pin"; el.textContent = "ŠTART";
      startMarker.current = new maplibregl.Marker({ element: el }).setLngLat([start.lon, start.lat]).addTo(m);
    } else startMarker.current.setLngLat([start.lon, start.lat]);
  }, [start]);

  // priblíženie na vybranú zastávku alebo na celú trasu
  useEffect(() => {
    const m = map.current;
    if (!focus) return;
    if (focus.type === "point") m.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(m.getZoom(), 16.5) });
    if (focus.type === "all") {
      const pts = stops.filter((s) => s.lat != null);
      if (!pts.length) return;
      const b = new maplibregl.LngLatBounds();
      pts.forEach((s) => b.extend([s.lon, s.lat]));
      if (start) b.extend([start.lon, start.lat]);
      m.fitBounds(b, { padding: 50, maxZoom: 16, duration: 600 });
    }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={"map" + (picking ? " picking" : "")} />;
}

function line(coords) {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
}
