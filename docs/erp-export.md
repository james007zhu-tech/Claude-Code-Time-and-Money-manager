# 报销单导出给 ERP 的数据格式

时间账本生成报销单后，可以：

- **导出给 ERP**：下载两个文件
  - `报销单-<期间>-ERP.json`：完整的结构化数据（下面的格式），可选带凭证图片（base64）；
  - `报销单-<期间>-ERP分录.csv`：每笔费用一行，带科目代码，Excel / 大多数 ERP 的批量导入都能用。
- **推送到 ERP**：在「设置 → 报销与 ERP 对接」里填推送地址和请求头，预览里点「推送到 ERP」，应用会把同样的 JSON 用 `POST` 发过去（`Content-Type: application/json`）。返回 2xx 视为成功，这些费用会标成「已提交」并记下单号。

> 浏览器直接调用 ERP 接口需要 ERP 允许跨域（CORS，允许来源为应用所在域名）。不方便改 ERP 时，用一个中间件接收再转发即可，例如 n8n / Make / Zapier 的 Webhook，或一个几十行的云函数。

## JSON 格式（`time-ledger.expense-claim/v1`）

```json
{
  "schema": "time-ledger.expense-claim/v1",
  "claimId": "EXP-20261031-48838",
  "createdAt": "2026-10-31T09:00:00.000Z",
  "period": { "label": "2026年10月", "from": "2026-10-02", "to": "2026-10-28" },
  "employee": { "name": "朱先生", "code": "E001" },
  "organization": "某某（泰国）有限公司 · 市场部",
  "costCenter": "MKT",
  "currency": "THB",
  "total": 30183.8,
  "exchangeRates": { "USD": 35.5, "CNY": 5 },
  "summary": [
    { "expenseItem": "交通费", "glAccount": "6601.01", "count": 6, "amount": 17891 }
  ],
  "lines": [
    {
      "lineNo": 1,
      "date": "2026-10-02",
      "expenseItem": "交通费",
      "glAccount": "6601.01",
      "category": "transport",
      "description": "Grab 打车去客户公司",
      "note": "",
      "paymentAccount": "个人泰铢卡",
      "originalAmount": 186,
      "originalCurrency": "THB",
      "exchangeRate": 1,
      "amount": 186,
      "receipts": [
        { "fileName": "receipt-1.jpg", "mimeType": "image/jpeg", "dataBase64": "…" }
      ],
      "sourceId": "rb0"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `claimId` | 报销单号，每次导出 / 推送生成一个 |
| `currency` / `total` | 报销币种和合计（外币已按 `exchangeRates` 折算） |
| `exchangeRates` | 1 单位外币 = 多少报销币种 |
| `summary` | 按报销科目汇总，`glAccount` 来自设置里的「科目 → ERP 科目代码」 |
| `lines[].lineNo` | 与报销单上的序号、凭证号一致 |
| `lines[].originalAmount` / `originalCurrency` | 原币金额 |
| `lines[].amount` | 折算后的报销金额 |
| `lines[].receipts` | 凭证图片；关闭「带上凭证图片」时只有文件名 |
| `lines[].sourceId` | 时间账本里这笔记录的 ID，可用于去重 |

报销科目：交通费、住宿差旅费、餐饮费、招待娱乐费、办公费、采购费、通讯水电费、培训费、礼品费、医疗费、其他费用。
