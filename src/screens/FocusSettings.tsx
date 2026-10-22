import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, Slider } from '../components/ui';
import { Segmented } from '../components/Segmented';
import { SUGGESTED_PACKAGES, type FocusConfig } from '../lib/focus';
import { Focus, focusSupported, isFocusConfigured, loadFocusConfig, saveFocusConfig, type Attempt, type FocusStatus, type InstalledApp } from '../lib/focusBridge';
import { useStore } from '../lib/store';


/** Configuración del modo dormir. */
export function FocusSettings({ onClose }: { onClose: () => void }) {
  const { settings } = useStore();
  const [cfg, setCfg] = useState<FocusConfig | null>(null);
  const [service, setService] = useState<FocusStatus | null>(null);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [query, setQuery] = useState('');
  const [tileHint, setTileHint] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refreshStatus = useCallback(() => {
    if (!focusSupported) return;
    void Focus.getStatus().then(setService);
    void Focus.getAttempts({ since: Date.now() - 7 * 86400000 }).then((r) => setAttempts(r.attempts));
  }, []);

  useEffect(() => {
    void loadFocusConfig().then(setCfg);
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
  const ready = !!service?.usageAccess && !!service?.overlay;
  const filtered = (apps ?? []).filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));
  const selectedFirst = [...filtered].sort((a, b) => Number(cfg.packages.includes(b.package)) - Number(cfg.packages.includes(a.package)));

  return (
    <Sheet title="😴 Modo dormir" onClose={onClose} size="full">
      <p className="muted">
        Al pulsar «Modo dormir» (aquí o en el panel rápido) empieza una cuenta atrás; después, las apps que elijas se
        pausan. Por la mañana, el primer desbloqueo del teléfono marca tu despertar y las apps siguen en pausa hasta que
        te levantas de verdad: dormir más no las desbloquea.
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
            <h3>1 · Permisos</h3>
            {!ready && (
              <p className="muted small">
                Dos permisos de bienestar digital. hiSleeper solo consulta qué app está delante durante tu horario de
                sueño; no lee ni guarda nada de lo que hay en pantalla.
              </p>
            )}
            <PermissionRow
              ok={!!service?.usageAccess}
              title="Acceso de uso"
              detail="Para saber qué app se abre."
              onFix={() => void Focus.openUsageAccessSettings()}
            />
            <PermissionRow
              ok={!!service?.overlay}
              title="Mostrar sobre otras apps"
              detail="Para ponerse delante de la app en pausa."
              onFix={() => void Focus.openOverlaySettings()}
            />
            {service && !service.exactAlarm && (
              <PermissionRow
                ok={false}
                optional
                title="Alarmas y recordatorios"
                detail="Para que la cuenta atrás y la alarma de la mañana sean puntuales."
                onFix={() => void Focus.openExactAlarmSettings()}
              />
            )}
            <button
              className="small"
              onClick={async () => {
                const r = await Focus.requestAddTile().catch(() => ({ supported: false, added: false }));
                setTileHint(!r.supported || !r.added);
              }}
            >
              ＋ Añadir «Modo dormir» al panel rápido
            </button>
            {tileHint && (
              <small className="muted">
                Desliza el panel de notificaciones hacia abajo dos veces, toca ✎ (editar) y arrastra «Modo dormir» a tus
                botones.
              </small>
            )}
          </section>

          <section className="card">
            <h3>2 · Al acostarte</h3>
            <label className="field check">
              <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} disabled={!ready && !cfg.enabled} />
              Modo dormir activado
            </label>
            <Slider
              label="Cuenta atrás"
              value={cfg.windDownMin}
              min={0}
              max={90}
              step={5}
              unit=" min"
              onChange={(v) => set({ windDownMin: v })}
              hint="Tiempo entre pulsar el botón y que se pausen las apps: para lavarte los dientes, leer, apagar luces."
            />
            <Slider
              label="Sueño mínimo"
              value={cfg.minSleepMin / 60}
              min={2}
              max={9}
              step={0.5}
              unit=" h"
              onChange={(v) => set({ minSleepMin: Math.round(v * 60) })}
              hint="Desbloquear antes no cuenta como despertar (ir al baño, mirar algo de madrugada): las apps siguen en pausa."
            />
          </section>

          <section className="card">
            <h3>3 · Al despertar</h3>
            <p className="muted small">
              El primer desbloqueo tras el sueño mínimo es tu despertar. Las apps siguen en pausa hasta superar el reto,
              sin tope de tiempo.
            </p>
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
            <label className="field check">
              <input type="checkbox" checked={cfg.antiSnooze} onChange={(e) => set({ antiSnooze: e.target.checked })} />
              Alarma si vuelvo a la cama
            </label>
            {cfg.antiSnooze && (
              <Slider
                label="Suena tras la pantalla apagada"
                value={cfg.snoozeMin}
                min={2}
                max={20}
                unit=" min"
                onChange={(v) => set({ snoozeMin: v })}
                hint="Si después de despertar dejas el móvil sin completar el reto, suena una alarma que sube de volumen. Se repite hasta que te levantas."
              />
            )}
            <small className="muted">
              ¿Despertaste de madrugada? Una vez por noche, y solo en la hora y media siguiente al sueño mínimo, puedes
              decir «aún es de noche» y seguir durmiendo.
            </small>
          </section>

          <section className="card">
            <h3>4 · Firmeza de noche</h3>
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

function PermissionRow({ ok, title, detail, onFix, optional }: { ok: boolean; title: string; detail: string; onFix: () => void; optional?: boolean }) {
  return (
    <div className="perm-row">
      <span className={`perm-dot ${ok ? 'ok' : optional ? 'opt' : ''}`} aria-hidden>
        {ok ? '✓' : ''}
      </span>
      <span className="grow">
        <b>{title}</b>
        <small className="muted">{detail}</small>
      </span>
      {ok ? (
        <small className="ok">Activo</small>
      ) : (
        <button className={optional ? 'small' : 'small primary'} onClick={onFix}>
          Activar
        </button>
      )}
    </div>
  );
}
