const assert = require('node:assert/strict');
const test = require('node:test');

const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');

function orderLine(price, fields = {}) {
  return { id: 1, name: 'Tea', sku: 'TEA', hsn: '0902', price, qty: 1, ...fields };
}

function bill(items, coupon) {
  const db = { nextOrderId: 1001, orders: [] };
  const billed = pricing.computeTotals(items, coupon);
  const saved = orders.add(db, { ...billed, items, coupon, date: '2026-11-21' });
  assert.strictEqual(orders.get(db, '1001'), saved);
  return { billed, saved, printed: invoice.computeInvoiceFigures(saved) };
}

function amounts({ subtotal, discount, tax, cgst, sgst, total }) {
  return { subtotal, discount, tax, cgst, sgst, total };
}

test('printable invoice reconciles a mixed-GST order with a capped coupon', () => {
  const { saved, printed } = bill([
    orderLine(1000, { name: 'Rice', hsn: '1006' }),
    orderLine(1000, { id: 2, name: 'Ghee', hsn: '0405' })
  ], 'SAVE10');
  assert.equal(saved.total, 2007.25);
  assert.equal(printed.total, saved.total);
  assert.equal(printed.discount, 150);
  assert.deepEqual(printed.rows.map(row => [row.gstPercent, row.lineTax]), [
    [5, 46.25], [12, 111]
  ]);
  const html = invoice.render(saved);
  assert.match(html, /Invoice Total<\/td><td class="r">₹2007\.25/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('18% GST without a coupon agrees with the recorded bill', () => {
  const { saved, printed } = bill([orderLine(100, { qty: 2 })]);
  assert.equal(saved.total, 236);
  assert.deepEqual(amounts(printed), {
    subtotal: 200, discount: 0, tax: 36, cgst: 18, sgst: 18, total: 236
  });
  assert.deepEqual(printed.rows, [{
    name: 'Tea', sku: 'TEA', hsn: '0902', qty: 2, price: 100,
    gstPercent: 18, line: 200, lineTax: 36
  }]);
  assert.doesNotMatch(invoice.render(saved), /Accountant Reconciliation Notice/);
});

test('invoice applies the HSN GST slab to each row', () => {
  const { billed, saved, printed } = bill([
    orderLine(100, { name: 'Rice', hsn: '1006' }),
    orderLine(200, { id: 2, name: 'Ghee', hsn: '0405' })
  ]);
  assert.deepEqual(billed.lines.map(line => [line.hsn, line.gstPercent, line.tax]), [
    ['1006', 5, 5], ['0405', 12, 24]
  ]);
  assert.deepEqual(amounts(billed), {
    subtotal: 300, discount: 0, tax: 29, cgst: 14.5, sgst: 14.5, total: 329
  });
  assert.equal(saved.tax, 29);
  assert.equal(saved.total, 329);
  assert.deepEqual(printed.rows.map(row => [row.hsn, row.gstPercent, row.lineTax]), [
    ['1006', 5, 5], ['0405', 12, 24]
  ]);
  assert.deepEqual(amounts(printed), {
    subtotal: 300, discount: 0, tax: 29, cgst: 14.5, sgst: 14.5, total: 329
  });
  const html = invoice.render(saved);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹29\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹329\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice caps a percentage coupon and applies it before GST', () => {
  const { billed, saved, printed } = bill([orderLine(2000)], 'SAVE10');
  assert.deepEqual(amounts(billed), {
    subtotal: 2000, discount: 150, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183
  });
  assert.deepEqual(amounts(printed), {
    subtotal: 2000, discount: 150, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183
  });
  assert.doesNotMatch(invoice.render(saved), /Accountant Reconciliation Notice/);
});

test('flat coupon reduces the taxable amount on the invoice', () => {
  const { billed, printed } = bill([orderLine(500)], 'FLAT50');
  assert.deepEqual(amounts(billed), {
    subtotal: 500, discount: 50, tax: 81, cgst: 40.5, sgst: 40.5, total: 531
  });
  assert.deepEqual(amounts(printed), {
    subtotal: 500, discount: 50, tax: 81, cgst: 40.5, sgst: 40.5, total: 531
  });
});

test('invoice GST totals sum the individually rounded row amounts', () => {
  const { billed, saved, printed } = bill([orderLine(0.03), orderLine(0.03, { id: 2 })]);
  assert.deepEqual(billed.lines.map(line => line.tax), [0.01, 0.01]);
  assert.deepEqual(printed.rows.map(row => row.lineTax), [0.01, 0.01]);
  assert.deepEqual(amounts(billed), {
    subtotal: 0.06, discount: 0, tax: 0.02, cgst: 0.01, sgst: 0.01, total: 0.08
  });
  assert.deepEqual(amounts(printed), {
    subtotal: 0.06, discount: 0, tax: 0.02, cgst: 0.01, sgst: 0.01, total: 0.08
  });
  assert.doesNotMatch(invoice.render(saved), /Accountant Reconciliation Notice/);
});

test('invoice accepts stored percentage, decimal, and zero GST rates', () => {
  const { billed, printed } = bill([
    orderLine(100, { gstRate: 5 }),
    orderLine(100, { id: 2, gstRate: 0.05 }),
    orderLine(100, { id: 3, gstRate: 0 })
  ]);
  assert.deepEqual(billed.lines.map(line => [line.gstPercent, line.tax]), [
    [5, 5], [5, 5], [0, 0]
  ]);
  assert.deepEqual(printed.rows.map(row => [row.gstPercent, row.lineTax]), [
    [5, 5], [5, 5], [0, 0]
  ]);
});
