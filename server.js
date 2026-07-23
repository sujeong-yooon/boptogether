const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_PARTICIPANTS = 10;

app.use(express.json());
app.use(express.static('public'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function orderWithParticipants(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  const participants = db
    .prepare('SELECT * FROM participants WHERE order_id = ? ORDER BY id ASC')
    .all(id);
  return { ...order, participants };
}

// 월 단위 주문 목록 (캘린더용)
app.get('/api/orders', (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) {
    return res.status(400).json({ error: 'year, month 파라미터가 필요합니다.' });
  }
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const orders = db
    .prepare(
      `SELECT o.*, (SELECT COUNT(*) FROM participants p WHERE p.order_id = o.id) as participant_count
       FROM orders o WHERE o.order_date LIKE ? ORDER BY o.order_date ASC, o.order_time ASC`
    )
    .all(`${prefix}-%`);
  res.json(orders);
});

// 특정 날짜 주문 목록
app.get('/api/orders/day', (req, res) => {
  const { date } = req.query;
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: '올바른 날짜(YYYY-MM-DD)가 필요합니다.' });
  }
  const orders = db
    .prepare(
      `SELECT o.*, (SELECT COUNT(*) FROM participants p WHERE p.order_id = o.id) as participant_count
       FROM orders o WHERE o.order_date = ? ORDER BY o.order_time ASC`
    )
    .all(date);
  res.json(orders);
});

// 주문 상세
app.get('/api/orders/:id', (req, res) => {
  const order = orderWithParticipants(req.params.id);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  res.json(order);
});

// 주문 등록
app.post('/api/orders', (req, res) => {
  const { ordererName, storeName, orderDate, orderTime } = req.body;
  if (!ordererName?.trim() || !storeName?.trim()) {
    return res.status(400).json({ error: '주문자이름과 매장명을 입력해주세요.' });
  }
  if (!orderDate || !DATE_RE.test(orderDate)) {
    return res.status(400).json({ error: '올바른 주문날짜를 입력해주세요.' });
  }
  if (!orderTime || !TIME_RE.test(orderTime)) {
    return res.status(400).json({ error: '올바른 주문시간을 입력해주세요.' });
  }
  const result = db
    .prepare(
      `INSERT INTO orders (orderer_name, store_name, order_date, order_time)
       VALUES (?, ?, ?, ?)`
    )
    .run(ordererName.trim(), storeName.trim(), orderDate, orderTime);
  res.status(201).json(orderWithParticipants(result.lastInsertRowid));
});

// 정산 방식(계좌 정보) 등록/수정
app.patch('/api/orders/:id', (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });

  const { bankName, accountNumber, accountHolder } = req.body;
  db.prepare(
    `UPDATE orders SET bank_name = ?, account_number = ?, account_holder = ? WHERE id = ?`
  ).run(
    bankName?.trim() || null,
    accountNumber?.trim() || null,
    accountHolder?.trim() || null,
    req.params.id
  );
  res.json(orderWithParticipants(req.params.id));
});

// 참여자 추가
app.post('/api/orders/:id/participants', (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });

  const { name, menu } = req.body;
  if (!name?.trim() || !menu?.trim()) {
    return res.status(400).json({ error: '이름과 메뉴를 입력해주세요.' });
  }

  const count = db
    .prepare('SELECT COUNT(*) as c FROM participants WHERE order_id = ?')
    .get(req.params.id).c;
  if (count >= MAX_PARTICIPANTS) {
    return res.status(400).json({ error: `참여자는 최대 ${MAX_PARTICIPANTS}명까지 가능합니다.` });
  }

  db.prepare(
    `INSERT INTO participants (order_id, name, menu) VALUES (?, ?, ?)`
  ).run(req.params.id, name.trim(), menu.trim());
  res.status(201).json(orderWithParticipants(req.params.id));
});

// 참여자 정산금액 입력/수정
app.patch('/api/orders/:id/participants/:pid', (req, res) => {
  const participant = db
    .prepare('SELECT id FROM participants WHERE id = ? AND order_id = ?')
    .get(req.params.pid, req.params.id);
  if (!participant) return res.status(404).json({ error: '참여자를 찾을 수 없습니다.' });

  const { amount } = req.body;
  const amountValue =
    amount === null || amount === '' || amount === undefined ? null : Number(amount);
  if (amountValue !== null && (Number.isNaN(amountValue) || amountValue < 0)) {
    return res.status(400).json({ error: '올바른 금액을 입력해주세요.' });
  }

  db.prepare('UPDATE participants SET amount = ? WHERE id = ?').run(
    amountValue,
    req.params.pid
  );
  res.json(orderWithParticipants(req.params.id));
});

// 참여자 삭제
app.delete('/api/orders/:id/participants/:pid', (req, res) => {
  const participant = db
    .prepare('SELECT id FROM participants WHERE id = ? AND order_id = ?')
    .get(req.params.pid, req.params.id);
  if (!participant) return res.status(404).json({ error: '참여자를 찾을 수 없습니다.' });

  db.prepare('DELETE FROM participants WHERE id = ?').run(req.params.pid);
  res.json(orderWithParticipants(req.params.id));
});

app.listen(PORT, () => {
  console.log(`boptogether server running on http://localhost:${PORT}`);
});
