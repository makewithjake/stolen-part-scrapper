/**
 * db.js – IndexedDB wrapper for Part Scrapper
 * Stores jobs with their items locally on the device.
 */

const DB_NAME = 'PartScrapperDB';
const DB_VERSION = 1;
const STORE_JOBS = 'jobs';

class PartScrapperDB {
  constructor() {
    this._db = null;
  }

  /** Open (or create) the database */
  async init() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_JOBS)) {
          const store = db.createObjectStore(STORE_JOBS, { keyPath: 'jobId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /** Save (create or update) a job */
  async saveJob(job) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_JOBS, 'readwrite');
      const store = tx.objectStore(STORE_JOBS);
      const request = store.put(job);
      request.onsuccess = () => resolve(job);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /** Get a single job by ID */
  async getJob(jobId) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_JOBS, 'readonly');
      const store = tx.objectStore(STORE_JOBS);
      const request = store.get(jobId);
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /** Get all jobs, sorted newest first */
  async getAllJobs() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_JOBS, 'readonly');
      const store = tx.objectStore(STORE_JOBS);
      const request = store.getAll();
      request.onsuccess = (e) => {
        const jobs = e.target.result || [];
        jobs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        resolve(jobs);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /** Delete a job by ID */
  async deleteJob(jobId) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_JOBS, 'readwrite');
      const store = tx.objectStore(STORE_JOBS);
      const request = store.delete(jobId);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /** Get total job count */
  async getJobCount() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_JOBS, 'readonly');
      const store = tx.objectStore(STORE_JOBS);
      const request = store.count();
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

// Export singleton
const db = new PartScrapperDB();
