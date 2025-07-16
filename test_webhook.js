const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  
  if (req.body.pre_checkout_query) {
    // Отвечаем OK на pre_checkout_query
    res.json({ ok: true });
  } else {
    res.json({ status: 'received' });
  }
});

app.listen(3001, () => {
  console.log('Webhook server running on port 3001');
});
