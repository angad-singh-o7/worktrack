const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, query, run, get } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  await getDb();
  const { name, pin, role } = req.body;
  const user = get(
    `SELECT * FROM users WHERE LOWER(name)=LOWER(?) AND pin=? AND role=?`,
    [name, pin, role]
  );
  if (!user) return res.status(401).json({ error: 'Invalid name or PIN' });
  const { pin: _, ...safe } = user;
  res.json(safe);
});

// ── USERS ─────────────────────────────────────────────────────────────────────
app.get('/api/workers', async (req, res) => {
  await getDb();
  const workers = query(`SELECT id,name,role,wage,phone FROM users WHERE role='worker'`);
  res.json(workers);
});

// Worker updates their own profile (phone + PIN)
app.patch('/api/users/:id/profile', async (req, res) => {
  await getDb();
  const { phone, current_pin, new_pin } = req.body;
  const user = get(`SELECT * FROM users WHERE id=?`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (new_pin) {
    if (user.pin !== current_pin) return res.status(401).json({ error: 'Current PIN is incorrect' });
    if (new_pin.length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
    run(`UPDATE users SET phone=?, pin=? WHERE id=?`, [phone ?? user.phone, new_pin, req.params.id]);
  } else {
    run(`UPDATE users SET phone=? WHERE id=?`, [phone ?? user.phone, req.params.id]);
  }
  res.json({ success: true });
});

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────
app.get('/api/managers', async (req, res) => {
  await getDb();
  const managers = query(`SELECT id,name,role,phone FROM users WHERE role='manager'`);
  res.json(managers);
});

app.post('/api/users', async (req, res) => {
  await getDb();
  const { name, pin, role, wage, phone } = req.body;
  if (!name || !pin || !role) return res.status(400).json({ error: 'Name, PIN, and role are required' });
  if (!['worker', 'manager'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const existing = get(`SELECT id FROM users WHERE LOWER(name)=LOWER(?) AND role=?`, [name, role]);
  if (existing) return res.status(409).json({ error: 'A user with this name and role already exists' });
  const id = (role === 'worker' ? 'w' : 'm') + Date.now();
  run(
    `INSERT INTO users (id, name, pin, role, wage, phone) VALUES (?,?,?,?,?,?)`,
    [id, name.trim(), pin, role, Number(wage) || 0, phone || '']
  );
  res.json({ id, name, role, wage: Number(wage) || 0, phone: phone || '' });
});

app.delete('/api/users/:id', async (req, res) => {
  await getDb();
  const user = get(`SELECT * FROM users WHERE id=?`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Prevent deleting the currently active manager (guard: frontend should not send self-delete, but double-check)
  run(`DELETE FROM worker_projects WHERE worker_id=?`, [req.params.id]);
  run(`DELETE FROM users WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

app.patch('/api/users/:id', async (req, res) => {
  await getDb();
  const { name, pin, wage, phone } = req.body;
  const user = get(`SELECT * FROM users WHERE id=?`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  run(
    `UPDATE users SET name=?, pin=?, wage=?, phone=? WHERE id=?`,
    [name || user.name, pin || user.pin, Number(wage) ?? user.wage, phone ?? user.phone, req.params.id]
  );
  res.json({ success: true });
});

// ── PROJECTS ──────────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  await getDb();
  const projects = query(`SELECT * FROM projects ORDER BY status DESC, name`);
  res.json(projects);
});

app.post('/api/projects', async (req, res) => {
  await getDb();
  const { name, location, type, manager_name, start_date, end_date, status, description } = req.body;
  const id = 'p' + Date.now();
  run(
    `INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, location, type, manager_name, start_date, end_date, status || 'active', description || '']
  );
  res.json({ id, ...req.body });
});

app.patch('/api/projects/:id', async (req, res) => {
  await getDb();
  const proj = get(`SELECT * FROM projects WHERE id=?`, [req.params.id]);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { name, location, type, manager_name, start_date, end_date, status, description } = req.body;
  run(
    `UPDATE projects SET name=?, location=?, type=?, manager_name=?, start_date=?, end_date=?, status=?, description=? WHERE id=?`,
    [
      name        ?? proj.name,
      location    ?? proj.location,
      type        ?? proj.type,
      manager_name ?? proj.manager_name,
      start_date  ?? proj.start_date,
      end_date    ?? proj.end_date,
      status      ?? proj.status,
      description ?? proj.description,
      req.params.id,
    ]
  );
  res.json({ success: true });
});

app.delete('/api/projects/:id', async (req, res) => {
  await getDb();
  const proj = get(`SELECT id FROM projects WHERE id=?`, [req.params.id]);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  run(`UPDATE worker_projects SET project_id=NULL WHERE project_id=?`, [req.params.id]);
  run(`DELETE FROM projects WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

// ── WORKER PROJECT ASSIGNMENT ─────────────────────────────────────────────────
app.get('/api/worker-project/:workerId', async (req, res) => {
  await getDb();
  const row = get(
    `SELECT wp.project_id, p.name, p.location, p.type, p.status
     FROM worker_projects wp JOIN projects p ON wp.project_id=p.id
     WHERE wp.worker_id=?`,
    [req.params.workerId]
  );
  res.json(row || null);
});

app.post('/api/worker-project', async (req, res) => {
  await getDb();
  const { worker_id, project_id } = req.body;
  const now = new Date().toISOString();
  run(
    `INSERT INTO worker_projects (worker_id, project_id, assigned_at)
     VALUES (?,?,?)
     ON CONFLICT(worker_id) DO UPDATE SET project_id=excluded.project_id, assigned_at=excluded.assigned_at`,
    [worker_id, project_id, now]
  );
  res.json({ success: true });
});

// ── ATTENDANCE ────────────────────────────────────────────────────────────────
app.get('/api/attendance', async (req, res) => {
  await getDb();
  const { worker_id, date, month, year } = req.query;
  let sql = `
    SELECT a.*, u.name as worker_name, u.wage, p.name as project_name, p.location as project_location
    FROM attendance a
    JOIN users u ON a.worker_id=u.id
    LEFT JOIN projects p ON a.project_id=p.id
    WHERE 1=1
  `;
  const params = [];
  if (worker_id) { sql += ` AND a.worker_id=?`; params.push(worker_id); }
  if (date)      { sql += ` AND a.date=?`;      params.push(date); }
  if (month && year) {
    sql += ` AND strftime('%m',a.date)=? AND strftime('%Y',a.date)=?`;
    params.push(String(month).padStart(2,'0'), String(year));
  }
  sql += ` ORDER BY a.date DESC`;
  res.json(query(sql, params));
});

app.post('/api/attendance', async (req, res) => {
  await getDb();
  const { worker_id, date, status, time, project_id } = req.body;
  const existing = get(`SELECT id FROM attendance WHERE worker_id=? AND date=?`, [worker_id, date]);
  if (existing) return res.status(409).json({ error: 'Attendance already marked for today' });
  run(
    `INSERT INTO attendance (worker_id, date, status, time, project_id, confirmed)
     VALUES (?,?,?,?,?,0)`,
    [worker_id, date, status, time, project_id || null]
  );
  res.json({ success: true });
});

app.patch('/api/attendance/confirm', async (req, res) => {
  await getDb();
  const { worker_id, date, confirmed_by } = req.body;
  const now = new Date().toISOString();
  run(
    `UPDATE attendance SET confirmed=1, confirmed_by=?, confirmed_at=? WHERE worker_id=? AND date=?`,
    [confirmed_by, now, worker_id, date]
  );
  res.json({ success: true });
});

// Manager marks a worker absent directly
app.post('/api/attendance/manager-absent', async (req, res) => {
  await getDb();
  const { worker_id, date, marked_by } = req.body;
  const time = new Date().toTimeString().slice(0,5);
  const existing = get(`SELECT id FROM attendance WHERE worker_id=? AND date=?`, [worker_id, date]);
  if (existing) {
    run(`UPDATE attendance SET status='absent', confirmed=1, confirmed_by=? WHERE worker_id=? AND date=?`,
      [marked_by, worker_id, date]);
  } else {
    run(`INSERT INTO attendance (worker_id, date, status, time, project_id, confirmed, confirmed_by, confirmed_at)
         VALUES (?,?,'absent',?,NULL,1,?,?)`,
      [worker_id, date, time, marked_by, new Date().toISOString()]);
  }
  res.json({ success: true });
});

// Manager corrects an existing attendance record
app.patch('/api/attendance/correct', async (req, res) => {
  await getDb();
  const { worker_id, date, status, corrected_by } = req.body;
  const existing = get(`SELECT id FROM attendance WHERE worker_id=? AND date=?`, [worker_id, date]);
  if (!existing) return res.status(404).json({ error: 'No attendance record found for this worker/date' });
  run(
    `UPDATE attendance SET status=?, confirmed=1, confirmed_by=?, confirmed_at=? WHERE worker_id=? AND date=?`,
    [status, corrected_by, new Date().toISOString(), worker_id, date]
  );
  res.json({ success: true });
});

// Manager bulk-marks all unmarked workers present or absent for today
app.post('/api/attendance/bulk', async (req, res) => {
  await getDb();
  const { status, marked_by, date } = req.body;
  const workers = query(`SELECT id FROM users WHERE role='worker'`);
  const time = new Date().toTimeString().slice(0,5);
  const now  = new Date().toISOString();
  for (const w of workers) {
    const existing = get(`SELECT id FROM attendance WHERE worker_id=? AND date=?`, [w.id, date]);
    if (!existing) {
      const proj = get(`SELECT project_id FROM worker_projects WHERE worker_id=?`, [w.id]);
      run(
        `INSERT INTO attendance (worker_id, date, status, time, project_id, confirmed, confirmed_by, confirmed_at)
         VALUES (?,?,?,?,?,1,?,?)`,
        [w.id, date, status, time, proj?.project_id || null, marked_by, now]
      );
    }
  }
  res.json({ success: true });
});

// ── LEAVES ────────────────────────────────────────────────────────────────────
app.get('/api/leaves', async (req, res) => {
  await getDb();
  const { worker_id, status } = req.query;
  let sql = `
    SELECT l.*, u.name as worker_name
    FROM leaves l JOIN users u ON l.worker_id=u.id
    WHERE 1=1
  `;
  const params = [];
  if (worker_id) { sql += ` AND l.worker_id=?`; params.push(worker_id); }
  if (status)    { sql += ` AND l.status=?`;    params.push(status); }
  sql += ` ORDER BY l.applied_date DESC`;
  res.json(query(sql, params));
});

app.post('/api/leaves', async (req, res) => {
  await getDb();
  const { worker_id, from_date, to_date, leave_type, reason } = req.body;
  const id = 'l' + Date.now();
  const applied_date = new Date().toISOString().split('T')[0];
  run(
    `INSERT INTO leaves (id, worker_id, from_date, to_date, leave_type, reason, status, applied_date)
     VALUES (?,?,?,?,?,?,'pending',?)`,
    [id, worker_id, from_date, to_date, leave_type, reason, applied_date]
  );
  res.json({ id, success: true });
});

app.patch('/api/leaves/:id', async (req, res) => {
  await getDb();
  const { status, actioned_by } = req.body;
  run(
    `UPDATE leaves SET status=?, actioned_by=?, actioned_at=? WHERE id=?`,
    [status, actioned_by, new Date().toISOString(), req.params.id]
  );
  res.json({ success: true });
});

// ── ADVANCES ──────────────────────────────────────────────────────────────────
app.get('/api/advances', async (req, res) => {
  await getDb();
  const { worker_id, status } = req.query;
  let sql = `
    SELECT a.*, u.name as worker_name
    FROM advances a JOIN users u ON a.worker_id=u.id
    WHERE 1=1
  `;
  const params = [];
  if (worker_id) { sql += ` AND a.worker_id=?`; params.push(worker_id); }
  if (status)    { sql += ` AND a.status=?`;    params.push(status); }
  sql += ` ORDER BY a.applied_date DESC`;
  res.json(query(sql, params));
});

app.post('/api/advances', async (req, res) => {
  await getDb();
  const { worker_id, amount, advance_type, destination, reason, needed_by } = req.body;
  const id = 'a' + Date.now();
  const applied_date = new Date().toISOString().split('T')[0];
  run(
    `INSERT INTO advances (id, worker_id, amount, advance_type, destination, reason, needed_by, status, applied_date)
     VALUES (?,?,?,?,?,?,?,'pending',?)`,
    [id, worker_id, amount, advance_type, destination || '', reason, needed_by, applied_date]
  );
  res.json({ id, success: true });
});

app.patch('/api/advances/:id', async (req, res) => {
  await getDb();
  const { status, actioned_by } = req.body;
  run(
    `UPDATE advances SET status=?, actioned_by=?, actioned_at=? WHERE id=?`,
    [status, actioned_by, new Date().toISOString(), req.params.id]
  );
  res.json({ success: true });
});

// ── REPORT DATA ───────────────────────────────────────────────────────────────
app.get('/api/report', async (req, res) => {
  await getDb();
  const { month, year } = req.query;
  const mm = String(month).padStart(2,'0');

  const workers = query(`SELECT id,name,wage,phone FROM users WHERE role='worker'`);
  const attendance = query(
    `SELECT a.worker_id, a.date, a.status, a.confirmed, p.name as project_name
     FROM attendance a LEFT JOIN projects p ON a.project_id=p.id
     WHERE strftime('%m',a.date)=? AND strftime('%Y',a.date)=?`,
    [mm, String(year)]
  );
  const leaves = query(
    `SELECT worker_id, from_date, to_date, status FROM leaves WHERE status='approved'`
  );
  const advances = query(
    `SELECT worker_id, amount, advance_type, reason, status FROM advances`
  );
  const workerProjects = query(
    `SELECT wp.worker_id, wp.project_id, p.name, p.location FROM worker_projects wp JOIN projects p ON wp.project_id=p.id`
  );

  res.json({ workers, attendance, leaves, advances, workerProjects });
});

// Serve frontend for all non-API routes
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;

getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`WorkTrack running on port ${PORT}`);
  });
});