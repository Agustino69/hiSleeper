import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, Slider } from '../components/ui';
import { Segmented } from '../components/Segmented';
import { SUGGESTED_PACKAGES, type FocusConfig } from '../lib/focus';
import { Focus, focusSupported, isFocusConfigured, loadFocusConfig, saveFocusConfig, type Attempt, type InstalledApp } from '../lib/focusBridge';
import { useStore } from '../lib/store';

const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/** Configuración de «Sin pantallas en la cama». */
export function FocusSettings({ onClose }: { onClose: () => void }) {
  const { settings } = useStore();
  const [cfg, setCfg] = useState<FocusConfig | null>(null);
  const [service, setService] = useState<{ serviceEnabled: boolean; sdk: number } | null>(null);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [query, setQuery] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refreshStatus = useCallback(() => {
    if (!focusSupported) return;
    void Focus.getStatus().then(setService);
    void Focus.getAttempts({ since: Date.now() - 7 * 86400000 }).then((r) => setAttempts(r.attempts));
  }, []);

  useEffect(() => {
    void loadFocusConfig().then((c) => setCfg(c.packages.length || c.enabled ? c : { ...c, wakeTime: settings.wakeTime || c.wakeTime }));
    refreshStatus();
    // Al volver de los ajustes de Android, comprueba si se activó el permiso.
    const onVis = () => document.visibilityState === 'visible' && refreshStatus();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshStatus, settings.wakeTime]);

  useEffect(() => {
    if (!focusSupported) return;
    void Focus.listApps().then((r) => setApps(r.apps.sort((a, b) => a.label.localeCompare(b.label))));
  }, []);

  // Primera vez (nada guardado aún): preselecciona las apps de scroll instaladas.
  const suggested = useRef(false);
  useEffect(() => {
    if (!cfg || !apps || suggested.current) return;
    suggested.current = true;
    void isFocusConfigured().then((configured) => {
      if (configured) return;
      const installed = new Set(apps.map((a) => a.package));
      const picks = SUGGESTED_PACKAGES.filter((p) => installed.has(p));
      if (picks.length) setCfg((c) => (c && !c.packages.length ? { ...c, packages: picks } : c));
    });
  }, [cfg, apps]);

  const loaded = useRef<FocusConfig | null>(null);
  useEffect(() => {
    if (!cfg) return;
    if (!loaded.current) {
      loaded.current = cfg;
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveFocusConfig(cfg), 400);
  }, [cfg]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const byApp = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const a of attempts) m.set(a.package, { label: a.label, n: (m.get(a.package)?.n ?? 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [attempts]);

  if (!cfg) return null;
  const set = (patch: Partial<FocusConfig>) => setCfg({ ...cfg, ...patch });
  const togglePkg = (p: string) => set({ packages: cfg.packages.includes(p) ? cfg.packages.filter((x) => x !== p) : [...cfg.packages, p] });
  const ready = !!service?.serviceEnabled;
  const filtered = (apps ?? []).filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));
  const selectedFirst = [...filtered].sort((a, b) => Number(cfg.packages.includes(b.package)) - Number(cfg.packages.includes(a.package)));

  return (
    <Sheet title="📵 Sin pantallas en la cama" onClose={onClose} size="full">

      <p className="muted">
        Las apps que elijas se bloquean desde un rato antes de dormir y por la mañana hasta que te levantas. Romper el
        hábito del scroll en la cama ayuda a dormirte antes y a no empezar el día en el móvil.
      </p>

      {!focusSupported ? (
        <section className="card">
          <p>
            El bloqueo de apps necesita la <b>app de Android</b>: el navegador no puede controlar otras apps.
          </p>
        </section>
      ) : (
        <>
          {attempts.length > 0 && (
            <section className="card">
              <h3>Últimos 7 días</h3>
              <p className="big-stat">
                {attempts.length} <small>aperturas evitadas</small>
              </p>
              <small className="muted">{byApp.slice(0, 4).map((a) => `${a.label} ${a.n}`).join(' · ')}</small>
            </section>
          )}

          <section className={`card ${ready ? '' : 'banner'}`}>
            <h3>1 · Permiso</h3>
            {ready ? (
              <p className="ok">✓ Permiso de accesibilidad activo</p>
            ) : (
              <>
                <p>
                  Activa <b>«hiSleeper · Sin pantallas en la cama»</b> en Accesibilidad. Solo detecta qué app se abre; no
                  lee la pantalla.
                </p>
                <button className="primary" onClick={() => void Focus.openAccessibilitySettings()}>
                  Abrir Accesibilidad
                </button>
                {(service?.sdk ?? 0) >= 33 && (
                  <small className="muted">
                    ¿Sale «Ajuste restringido»? Es normal en apps instaladas fuera de Google Play: abre{' '}
                    <button className="link" onClick={() => void Focus.openAppSettings()}>
                      Info de la app
                    </button>
                    , toca ⋮ (arriba a la derecha) → «Permitir ajustes restringidos», y vuelve a intentarlo.
                  </small>
                )}
              </>
            )}
          </section>

          <section className="card">
            <h3>2 · Horario</h3>
            <label className="field check">
              <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} disabled={!ready && !cfg.enabled} />
              Bloqueo activado
            </label>
            <div className="time-row">
              <label className="field">
                <span>Me acuesto</span>
                <input type="time" value={cfg.bedtime} onChange={(e) => set({ bedtime: e.target.value })} />
              </label>
              <label className="field">
                <span>Me despierto</span>
                <input type="time" value={cfg.wakeTime} onChange={(e) => set({ wakeTime: e.target.value })} />
              </label>
            </div>
            <Slider
              label="Desconectar antes de acostarme"
              value={cfg.windDownMin}
              min={0}
              max={120}
              step={15}
              unit=" min"
              onChange={(v) => set({ windDownMin: v })}
              hint="La luz y los estímulos del móvil retrasan el sueño; una hora sin pantallas es lo ideal."
            />
            <div className="chips" role="group" aria-label="Días">
              {DAYS.map((d, i) => (
                <button
                  key={i}
                  className={`chip day ${cfg.days.includes(i) ? 'on' : ''}`}
                  onClick={() => set({ days: cfg.days.includes(i) ? cfg.days.filter((x) => x !== i) : [...cfg.days, i].sort() })}
                >
                  {d}
                </button>
              ))}
            </div>
            <small className="muted">Días en los que te despiertas con el bloqueo. La noche anterior también cuenta.</small>
            <small className="muted">Además, mientras una sesión nocturna esté en marcha, las apps siempre se bloquean.</small>
          </section>

          <section className="card">
            <h3>3 · Al despertar</h3>
            <label className="field check">
              <input type="checkbox" checked={cfg.morningLock} onChange={(e) => set({ morningLock: e.target.checked })} />
              Mantener el bloqueo hasta levantarme
            </label>
            {cfg.morningLock && (
              <>
                <Segmented
                  label="Reto para desbloquear"
                  value={cfg.challenge}
                  onChange={(v) => set({ challenge: v })}
                  options={[
                    { value: 'steps', label: '🚶 Caminar', hint: `${cfg.steps} pasos` },
                    { value: 'journal', label: '✍️ Anotar mi sueño', hint: 'en el diario' },
                  ]}
                />
                {cfg.challenge === 'steps' && (
                  <Slider label="Pasos" value={cfg.steps} min={20} max={200} step={10} onChange={(v) => set({ steps: v })} hint="Camina con el móvil en la mano: hasta el baño o la cocina." />
                )}
                <Slider
                  label="Se desbloquea solo tras"
                  value={cfg.morningMaxMin}
                  min={15}
                  max={180}
                  step={15}
                  unit=" min"
                  onChange={(v) => set({ morningMaxMin: v })}
                  hint="Tope de seguridad por si no puedes hacer el reto."
                />
              </>
            )}
          </section>

          <section className="card">
            <h3>4 · Firmeza</h3>
            <Segmented
              label="Firmeza"
              value={cfg.allowOverride ? 'friction' : 'strict'}
              onChange={(v) => set({ allowOverride: v === 'friction' })}
              options={[
                { value: 'friction', label: 'Con fricción', hint: 'abrir tras esperar' },
                { value: 'strict', label: 'Estricto', hint: 'sin excepciones' },
              ]}
            />
            {cfg.allowOverride ? (
              <>
                <Slider label="Espera para abrir de todos modos" value={cfg.overrideDelaySec} min={5} max={60} step={5} unit=" s" onChange={(v) => set({ overrideDelaySec: v })} />
                <Slider label="Permiso temporal" value={cfg.overrideMin} min={1} max={30} unit=" min" onChange={(v) => set({ overrideMin: v })} />
              </>
            ) : (
              <small className="muted">Teléfono, mensajes, reloj y ajustes nunca se bloquean.</small>
            )}
          </section>

          <section className="card">
            <h3>5 · Apps ({cfg.packages.length})</h3>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar app…" />
            {apps == null ? (
              <p className="muted">Cargando apps…</p>
            ) : (
              <ul className="app-list">
                {selectedFirst.map((a) => (
                  <li key={a.package}>
                    <label>
                      {a.icon ? <img src={a.icon} alt="" width={36} height={36} /> : <span className="app-icon-ph" />}
                      <span className="grow">{a.label}</span>
                      <input type="checkbox" checked={cfg.packages.includes(a.package)} onChange={() => togglePkg(a.package)} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Sheet>
  );
}
