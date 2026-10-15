import { invoiceExtractionSchema } from "./invoice";
import type { ExpenseCategory } from "./invoice";
import type { ExpenseRecord } from "./csv";

const databaseName = "invoicepilot-expenses";
const storeName = "expenses";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local storage transaction failed."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Local storage transaction was interrupted."));
    };
  });
}

export async function listExpenses(): Promise<ExpenseRecord[]> {
  const records = await withStore("readonly", (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveExpense(
  extraction: unknown,
  existing?: ExpenseRecord,
): Promise<ExpenseRecord> {
  const parsed = invoiceExtractionSchema.parse(extraction);
  const now = new Date().toISOString();
  const record: ExpenseRecord = {
    ...parsed,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await withStore("readwrite", (store) => store.put(record));
  return record;
}

export async function removeExpense(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export function filterExpenses(
  records: ExpenseRecord[],
  search: string,
  category: ExpenseCategory | "All categories",
): ExpenseRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return records.filter((record) => {
    const matchesSearch =
      query.length === 0 ||
      [record.vendor, record.invoiceNumber].some((value) =>
        value?.toLocaleLowerCase().includes(query),
      );
    return matchesSearch && (category === "All categories" || record.category === category);
  });
}