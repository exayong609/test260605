import { ORDER_FIELD_LABELS } from "@/lib/fields";
import type { OrderGroup, ParsedOrderRow, ValidationIssue } from "@/types";

function isBlank(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

export function groupRows(rows: ParsedOrderRow[]): OrderGroup[] {
  const buckets = new Map<string, OrderGroup>();

  rows.forEach((row) => {
    const key = row.externalCode?.trim() || `${row.storeName || row.recipientPhone || "order"}_${row.rowNumber}`;
    const existing = buckets.get(key);
    const skuLine = {
      skuCode: row.skuCode,
      skuName: row.skuName,
      skuQuantity: row.skuQuantity,
      skuSpec: row.skuSpec,
      remark: row.remark
    };

    if (existing) {
      existing.skuLines.push(skuLine);
      existing.rowIds.push(row.id);
      existing.storeName ||= row.storeName;
      existing.recipientName ||= row.recipientName;
      existing.recipientPhone ||= row.recipientPhone;
      existing.recipientAddress ||= row.recipientAddress;
      existing.remark ||= row.remark;
      return;
    }

    buckets.set(key, {
      id: key,
      externalCode: row.externalCode,
      storeName: row.storeName,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      recipientAddress: row.recipientAddress,
      remark: row.remark,
      skuLines: [skuLine],
      rowIds: [row.id]
    });
  });

  return Array.from(buckets.values());
}

export function validateRows(rows: ParsedOrderRow[], existingExternalCodes: string[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, ParsedOrderRow>();
  const existing = new Set(existingExternalCodes.filter(Boolean));

  rows.forEach((row) => {
    (["skuCode", "skuName", "skuQuantity"] as const).forEach((field) => {
      if (isBlank(row[field])) {
        issues.push({
          id: `${row.id}_${field}_required`,
          severity: "error",
          rowId: row.id,
          rowNumber: row.rowNumber,
          field,
          message: `${ORDER_FIELD_LABELS[field]}不能为空`
        });
      }
    });

    if (!Number.isFinite(Number(row.skuQuantity)) || Number(row.skuQuantity) <= 0) {
      issues.push({
        id: `${row.id}_skuQuantity_positive`,
        severity: "error",
        rowId: row.id,
        rowNumber: row.rowNumber,
        field: "skuQuantity",
        message: "SKU发货数量必须为正数"
      });
    }

    const hasStore = !isBlank(row.storeName);
    const hasRecipientGroup = !isBlank(row.recipientName) && !isBlank(row.recipientPhone) && !isBlank(row.recipientAddress);
    if (!hasStore && !hasRecipientGroup) {
      issues.push({
        id: `${row.id}_receiver_group`,
        severity: "error",
        rowId: row.id,
        rowNumber: row.rowNumber,
        field: "order",
        message: "收货门店，或收件人姓名+电话+地址，两组至少填写一组"
      });
    }

    if (!isBlank(row.recipientPhone) && !/^(\+?86[-\s]?)?1[3-9]\d{9}$|^[0-9][0-9\-\s]{6,18}$/.test(String(row.recipientPhone).trim())) {
      issues.push({
        id: `${row.id}_phone_format`,
        severity: "error",
        rowId: row.id,
        rowNumber: row.rowNumber,
        field: "recipientPhone",
        message: "收件人电话格式不正确"
      });
    }

    if (row.externalCode) {
      const prev = seen.get(row.externalCode);
      if (prev) {
        issues.push({
          id: `${row.id}_external_duplicate_batch`,
          severity: "warning",
          rowId: row.id,
          rowNumber: row.rowNumber,
          field: "externalCode",
          message: `外部编码与第 ${prev.rowNumber} 行重复，将聚合为同一出库单`
        });
      } else {
        seen.set(row.externalCode, row);
      }

      if (existing.has(row.externalCode)) {
        issues.push({
          id: `${row.id}_external_duplicate_existing`,
          severity: "error",
          rowId: row.id,
          rowNumber: row.rowNumber,
          field: "externalCode",
          message: "外部编码与历史已导入数据重复"
        });
      }
    }
  });

  return issues;
}
