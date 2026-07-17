import { MappingActivityEntry } from "./analytics";
import { BrandRecord, PriorityQueueItem } from "./types";

const xml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const cell = (value: unknown, type = "String") => `<Cell><Data ss:Type="${type}">${xml(value)}</Data></Cell>`;
const row = (values: unknown[], header = false) => `<Row${header ? ' ss:StyleID="Header"' : ""}>${values.map((value) => cell(value, typeof value === "number" ? "Number" : "String")).join("")}</Row>`;
const sheet = (name: string, rows: string[]) => `<Worksheet ss:Name="${xml(name)}"><Table>${rows.join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;

export function analyticsExcelXml(entries: MappingActivityEntry[], records: BrandRecord[], priorityQueue: PriorityQueueItem[], generatedAt = new Date().toISOString()) {
  const successful = records.filter((record) => record.adminUploadStatus === "SUCCESS");
  const failed = records.filter((record) => record.adminUploadStatus === "FAILED");
  const pending = records.filter((record) => !record.adminUploadStatus && !record.excludedFromExport);
  const actionCounts = { CREATE: 0, MERGE: 0, SKIP: 0, DELETE: 0 };
  entries.forEach((entry) => { actionCounts[entry.action] += 1; });
  const summary = [
    row(["Brandmaster Analytics Report", "Value"], true),
    row(["Generated", generatedAt]), row(["Recorded mapping actions", entries.length]),
    row(["CREATE", actionCounts.CREATE]), row(["MERGE", actionCounts.MERGE]), row(["SKIP", actionCounts.SKIP]), row(["DELETE", actionCounts.DELETE]),
    row(["Admin successful", successful.length]), row(["Admin failed", failed.length]), row(["Awaiting Admin result", pending.length]),
    row(["High priority tasks", priorityQueue.length]), row(["High priority completed", priorityQueue.filter((item) => item.status === "COMPLETED").length]),
  ];
  const activity = [row(["Date", "Action", "Reviewer"], true), ...entries.map((entry) => row([entry.date, entry.action, entry.reviewer || "Unattributed"]))];
  const outcomes = [row(["UnmappedBrandID", "Brand", "Action", "Admin Status", "Processed At", "Result File", "Message", "Created BrandID"], true), ...records.map((record) => row([record.id, record.name, record.action, record.adminUploadStatus || "PENDING", record.adminUploadedAt || "", record.adminUploadResultFile || "", record.adminUploadMessage || "", record.createdBrandId || ""]))];
  const queue = [row(["Brand", "Brand ID", "Source", "Owner", "Status", "Final Action", "Exported At", "Verified At"], true), ...priorityQueue.map((item) => row([item.name, item.brandId, item.source, item.assignedTo || "Unassigned", item.status, item.finalAction || "", item.exportedAt || "", item.verifiedAt || ""]))];
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="11"/></Style><Style ss:ID="Header"><Font ss:FontName="Arial" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#3665F3" ss:Pattern="Solid"/></Style></Styles>${sheet("Summary", summary)}${sheet("Mapping Activity", activity)}${sheet("Admin Outcomes", outcomes)}${sheet("High Priority Queue", queue)}</Workbook>`;
}
