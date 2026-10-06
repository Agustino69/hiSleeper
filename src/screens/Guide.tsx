import { isNative } from '../lib/native';

export function GuideScreen() {
  return (
    <div className="screen guide">
      <header className="screen-head">
        <h1>Cómo funciona</h1>
        <p className="muted">Lo que dice la investigación y cómo lo usa la app.</p>
      </header>

      <section className="card">
        <h3>Lo honesto primero</h3>
        <p>
          Dormido no se aprende información <em>nueva</em>: un audio con datos que nunca estudiaste no se queda. Lo
          que sí está demostrado es que el cerebro dormido puede <b>reforzar lo que ya aprendiste</b> y que lo que
          oyes al dormirte o en REM puede <b>colarse en tus sueños</b>. Los «subliminales» funcionan cuando se usan
          así: como recordatorios suaves de algo que trabajaste despierto.
        </p>
      </section>

      <section className="card">
        <h3>📚 Repasar: reactivación dirigida de la memoria</h3>
        <p>
          En los estudios de <i>targeted memory reactivation</i> (TMR), la gente aprende algo mientras suena un sonido
          concreto; después ese mismo sonido se reproduce, muy bajo, durante el sueño profundo (N3). Lo asociado a ese
          sonido se recuerda mejor al día siguiente que lo no reactivado.
        </p>
        <ol>
          <li>Crea un objetivo de repaso: cada tema con su propia señal.</li>
          <li>Antes de dormir, pulsa «Estudiar con la señal» y repasa las tarjetas.</li>
          <li>Esa noche, la señal suena solo en las ventanas estimadas de sueño profundo (primeros ciclos).</li>
        </ol>
        <p className="muted small">Si añades voz, usa palabras clave de lo estudiado, no explicaciones largas.</p>
      </section>

      <section className="card">
        <h3>🌙 Soñar con algo: incubación</h3>
        <p>
          Al quedarte dormido (hipnagogia) eres muy sugestionable: si oyes tu tema justo entonces, aparece mucho más en
          los sueños. Las pistas vuelven a sonar, muy bajas, en los REM largos de la madrugada, que es cuando más se
          sueña. Antes de dormir haz la visualización de 3 min con la señal.
        </p>
        <p className="muted small">
          Al despertar, quédate quieto y anota enseguida: el recuerdo de un sueño se evapora en minutos.
        </p>
      </section>

      <section className="card">
        <h3>🕯️ Mantras y afirmaciones</h3>
        <p>
          Tienen más efecto cuando todavía puedes procesarlos: al acostarte y en el duermevela antes de despertar. Por
          eso suenan al principio, bajando de volumen mientras te duermes, y en los 20 minutos previos a tu alarma.
          Grábalos con tu voz, en presente y primera persona.
        </p>
      </section>

      <section className="card">
        <h3>✨ Voces IA</h3>
        <p>
          En «Pistas → Voz IA» escribes un guion y eliges un estilo (susurro, cuentacuentos, capitán pirata…). Cada
          estilo ajusta ritmo, expresividad, tono, pausas, eco y calidez; puedes afinarlos a mano.
        </p>
        <ul>
          <li>
            <b>Neural en el teléfono:</b> voces naturales que se descargan una vez y funcionan sin conexión.
          </li>
          <li>
            <b>Nube:</b> la más expresiva, actúa según tus indicaciones («voz ronca de viejo pirata»). Necesita tu clave
            de OpenAI y conexión solo al generarla.
          </li>
          <li>
            Escribe en presente, frases cortas y con detalles de los sentidos. Usa «...» o [pausa 2] para dar aire.
          </li>
        </ul>
      </section>

      <section className="card">
        <h3>Reglas para que funcione (y no arruine tu sueño)</h3>
        <ul>
          <li>
            <b>Volumen mínimo.</b> Un sonido que te despierta destruye justo lo que quieres reforzar. Calibra acostado
            con el fondo sonando: apenas audible.
          </li>
          <li>
            <b>Ruido de fondo.</b> El ruido rosa enmascara la casa y suaviza la entrada de cada pista.
          </li>
          <li>
            <b>Movimiento = pausa.</b> Con el móvil sobre el colchón, si te mueves (señal de sueño ligero o
            despertar) las pistas se pausan y bajan de volumen el resto de la noche.
          </li>
          <li>
            <b>Ciclos estimados.</b> Sin un sensor de ondas cerebrales la app estima tus fases. Ajusta cuánto tardas en
            dormirte y la duración de tu ciclo hasta que despertar a las horas sugeridas te resulte fácil.
          </li>
          <li>
            <b>Constancia.</b> Mira tu diario: si duermes peor, baja volumen o reduce objetivos.
          </li>
          <li>
            <b>Auriculares no.</b> Mejor un altavoz cerca de la almohada; los auriculares molestan y son más ruidosos.
          </li>
        </ul>
      </section>

      <section className="card">
        <h3>En el móvil</h3>
        {isNative ? (
          <ul>
            <li>El audio sigue sonando con la pantalla apagada (verás una notificación de «sesión nocturna»).</li>
            <li>El detector de movimiento necesita la pantalla encendida: si lo usas, queda en negro toda la noche.</li>
            <li>Conecta el cargador y activa «No molestar»; las notificaciones fragmentan el sueño.</li>
            <li>
              Si el audio se corta de madrugada, quita a hiSleeper de la optimización de batería (Ajustes → Apps →
              hiSleeper → Batería → Sin restricciones).
            </li>
          </ul>
        ) : (
          <ul>
            <li>Instala la app («Añadir a pantalla de inicio») para usarla sin conexión.</li>
            <li>Conecta el cargador: la pantalla queda negra pero encendida toda la noche.</li>
            <li>Activa «No molestar» y el modo avión; las notificaciones fragmentan el sueño.</li>
            <li>En iPhone, desactiva el bloqueo automático o deja la app en primer plano.</li>
          </ul>
        )}
        <p className="muted small">
          Todo (grabaciones, diario, ajustes) se guarda solo en este dispositivo. hiSleeper no es un dispositivo médico:
          si tienes insomnio o apnea, consulta a un especialista.
        </p>
      </section>
    </div>
  );
}
