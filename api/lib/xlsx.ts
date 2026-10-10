import ExcelJS from 'exceljs';

type XlsxCell = string | number | null | undefined;

export async function buildXlsx(rows: XlsxCell[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Timesheets');

  rows.forEach((row) => {
    sheet.addRow(row.map((value) => value ?? ''));
  });

  if (rows.length > 0) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, rows.length),
        column: Math.max(1, rows[0]?.length || 1)
      }
    };
  }

  sheet.columns.forEach((column) => {
    let width = 10;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      width = Math.max(width, String(cell.value ?? '').length + 2);
    });

    column.width = Math.min(width, 32);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
