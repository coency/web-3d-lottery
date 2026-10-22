import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

test('ExcelJS writes and reads extended icon sets with the overridden CommonJS uuid dependency', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('中奖名单');
  sheet.addRows([['昵称', '分数'], ['参与者 🌟', 80], ['参与者二', 20]]);
  // Extended icon sets exercise ExcelJS's actual uuid.v4() call when writing XML.
  sheet.addConditionalFormatting({
    ref: 'B2:B3',
    rules: [{type: 'iconSet', iconSet: '3Stars', cfvo: [
      {type: 'percent', value: 0},
      {type: 'percent', value: 33},
      {type: 'percent', value: 67},
    ]}],
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const id = sheet.conditionalFormattings[0].rules[0].x14Id;
  assert.match(id, /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const result = restored.getWorksheet('中奖名单');
  assert.equal(result.getCell('A2').value, '参与者 🌟');
  assert.equal(result.getCell('B2').value, 80);
  assert.equal(result.conditionalFormattings[0].rules[0].iconSet, '3Stars');
});
