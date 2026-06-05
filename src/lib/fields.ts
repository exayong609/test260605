import type { OrderField } from "@/types";

export const ORDER_FIELD_LABELS: Record<OrderField, string> = {
  externalCode: "外部编码",
  storeName: "收货门店",
  recipientName: "收件人姓名",
  recipientPhone: "收件人电话",
  recipientAddress: "收件人地址",
  skuCode: "SKU物品编码",
  skuName: "SKU物品名称",
  skuQuantity: "SKU发货数量",
  skuSpec: "SKU规格型号",
  remark: "备注"
};

export const ORDER_FIELDS = Object.keys(ORDER_FIELD_LABELS) as OrderField[];

export const REQUIRED_SKU_FIELDS: OrderField[] = ["skuCode", "skuName", "skuQuantity"];

export const FIELD_HINTS: Record<OrderField, string[]> = {
  externalCode: ["外部编码", "外部单号", "订单号", "配送单号", "单号", "业务单号", "externalCode", "orderNo"],
  storeName: ["收货门店", "门店", "客户", "机构", "店名", "收货单位", "storeName", "store"],
  recipientName: ["收件人姓名", "收件人", "收货人", "联系人", "姓名", "recipientName", "receiver"],
  recipientPhone: ["收件人电话", "电话", "手机号", "联系方式", "联系号码", "recipientPhone", "phone"],
  recipientAddress: ["收件人地址", "地址", "收货地址", "详细地址", "recipientAddress", "address"],
  skuCode: ["SKU物品编码", "SKU编码", "物品编码", "商品编码", "编码", "货号", "skuCode", "itemCode"],
  skuName: ["SKU物品名称", "SKU名称", "物品名称", "商品名称", "品名", "名称", "skuName", "itemName"],
  skuQuantity: ["SKU发货数量", "发货数量", "数量", "应发", "实发", "订货量", "skuQuantity", "quantity"],
  skuSpec: ["SKU规格型号", "规格型号", "规格", "型号", "单位", "skuSpec", "spec"],
  remark: ["备注", "说明", "附言", "remark", "note"]
};
