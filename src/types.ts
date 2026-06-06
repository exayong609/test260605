export type OrderField =
  | "externalCode"
  | "storeName"
  | "recipientName"
  | "recipientPhone"
  | "recipientAddress"
  | "skuCode"
  | "skuName"
  | "skuQuantity"
  | "skuSpec"
  | "remark";

export type SourceKind = "excel" | "word" | "pdf" | "unknown";

export type GridSheet = {
  name: string;
  rows: string[][];
};

export type IntermediateDocument = {
  id: string;
  fileName: string;
  sourceKind: SourceKind;
  sheets: GridSheet[];
  text: string;
  pages: string[];
  stats: {
    sheetCount: number;
    rowCount: number;
    pageCount: number;
    charCount: number;
  };
  sample: string;
};

export type FieldMapping =
  | { kind: "column"; field: OrderField; columnIndex?: number; header?: string; fallback?: string }
  | { kind: "cell"; field: OrderField; rowIndex: number; columnIndex: number; fallback?: string }
  | { kind: "regex"; field: OrderField; pattern: string; group?: number; scope?: "document" | "section" | "tail"; fallback?: string }
  | { kind: "constant"; field: OrderField; value: string }
  | { kind: "sheetName"; field: OrderField }
  | { kind: "matrixColumn"; field: OrderField }
  | { kind: "compoundPart"; field: OrderField; part: "name" | "quantity" };

export type ParsingRule = {
  id: string;
  name: string;
  description?: string;
  sourceKind: SourceKind | "any";
  layout: "tabular" | "matrix" | "cards" | "textBlocks" | "multiSection";
  createdAt: string;
  updatedAt: string;
  generationPrompt?: string;
  aiGenerated?: boolean;
  builtIn?: boolean;
  confidence?: number;
  assumptions?: string[];
  sheetMode?: "first" | "all";
  autoDetectHeader?: boolean;
  headerSearchRows?: number;
  headerRowIndex?: number;
  dataStartRowIndex?: number;
  dataEndRowIndex?: number;
  stopWhenRowMatches?: string;
  skipRowPatterns?: string[];
  sectionStartPattern?: string;
  sectionSeparatorPattern?: string;
  itemLinePattern?: string;
  matrix?: {
    headerRowIndex: number;
    dataStartRowIndex: number;
    fixedColumns: Partial<Record<OrderField, number>>;
    matrixStartColumnIndex: number;
    matrixEndColumnIndex?: number;
    compoundSeparatorPattern?: string;
  };
  groupBy?: OrderField;
  mappings: FieldMapping[];
};

export type LlmProtocol = "openai-compatible" | "anthropic-compatible" | "minimax-native";

export type LlmProfile = {
  id: string;
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature?: number;
  timeoutMs?: number;
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LlmProfileView = Omit<LlmProfile, "apiKey"> & {
  hasApiKey: boolean;
  source?: "env" | "stored";
};

export type SkuLine = {
  skuCode: string;
  skuName: string;
  skuQuantity: number | string;
  skuSpec?: string;
  remark?: string;
};

export type ParsedOrderRow = {
  id: string;
  rowNumber: number;
  externalCode?: string;
  storeName?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec?: string;
  remark?: string;
  sourceSheet?: string;
  sourceSection?: string;
  warnings?: string[];
};

export type OrderGroup = {
  id: string;
  externalCode?: string;
  storeName?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  remark?: string;
  skuLines: SkuLine[];
  rowIds: string[];
  submittedAt?: string;
};

export type ValidationIssue = {
  id: string;
  severity: "error" | "warning";
  rowId?: string;
  rowNumber?: number;
  field?: OrderField | "order";
  message: string;
};

export type ParseResult = {
  rows: ParsedOrderRow[];
  groups: OrderGroup[];
  issues: ValidationIssue[];
  elapsedMs: number;
};

export type SubmitResult = {
  successCount: number;
  failureCount: number;
  issues: ValidationIssue[];
};
