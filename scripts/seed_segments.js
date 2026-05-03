import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://dev_user:dev_password@localhost:5432/postgres_dev'
});

const sessionId = 'fe3199e3-0d35-4e52-965f-bbcbf62f176d';

const segments = [
  {
    id: crypto.randomUUID(),
    session_id: sessionId,
    speaker_label: 'Speaker 1',
    original_text: 'Good morning everyone, thank you for joining this meeting today.',
    translated_text: 'Buenos dias a todos, gracias por unirse a esta reunion hoy.',
    start_time: 0.0,
    end_time: 3.5,
    is_final: true,
  },
  {
    id: crypto.randomUUID(),
    session_id: sessionId,
    speaker_label: 'Speaker 2',
    original_text: 'Thanks for having me. I wanted to discuss the quarterly report.',
    translated_text: 'Gracias por invitarme. Quería discutir el informe trimestral.',
    start_time: 3.8,
    end_time: 7.2,
    is_final: true,
  },
  {
    id: crypto.randomUUID(),
    session_id: sessionId,
    speaker_label: 'Speaker 1',
    original_text: 'Absolutely, the numbers look very promising this quarter.',
    translated_text: 'Por supuesto, los numeros se ven muy prometedores este trimestre.',
    start_time: 7.5,
    end_time: 10.8,
    is_final: true,
  },
  {
    id: crypto.randomUUID(),
    session_id: sessionId,
    speaker_label: 'Speaker 3',
    original_text: 'I agree. The marketing team did an excellent job with the campaign.',
    translated_text: 'Estoy de acuerdo. El equipo de marketing hizo un trabajo excelente con la campana.',
    start_time: 11.2,
    end_time: 15.0,
    is_final: true,
  },
  {
    id: crypto.randomUUID(),
    session_id: sessionId,
    speaker_label: 'Speaker 2',
    original_text: 'Should we also review the budget allocation for next quarter?',
    translated_text: 'Deberiamos tambien revisar la asignacion de presupuesto para el proximo trimestre?',
    start_time: 15.3,
    end_time: 18.7,
    is_final: true,
  },
  {
    id: crypto.randomUUID(),
    session_id: sessionId,
    speaker_label: 'Speaker 1',
    original_text: 'Yes, that is a great idea. Let me pull up the spreadsheet.',
    translated_text: 'Si, esa es una gran idea. Déjame abrir la hoja de calculo.',
    start_time: 19.0,
    end_time: 22.5,
    is_final: true,
  },
];

async function seed() {
  for (const seg of segments) {
    await pool.query(
      `INSERT INTO transcript_segment (id, session_id, speaker_label, original_text, translated_text, start_time, end_time, is_final)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [seg.id, seg.session_id, seg.speaker_label, seg.original_text, seg.translated_text, seg.start_time, seg.end_time, seg.is_final]
    );
  }

  await pool.query(
    `UPDATE transcription_session SET source_language = 'English', speaker_count = 3, duration_seconds = 23 WHERE id = $1`,
    [sessionId]
  );

  console.log('Seeded 6 transcript segments');
  const result = await pool.query(`SELECT count(*) FROM transcript_segment WHERE session_id = $1`, [sessionId]);
  console.log('Total segments:', result.rows[0].count);
  await pool.end();
}

seed().catch(e => { console.error(e); process.exit(1); });
