import Database from '../drivers/database';
import ProcessManager from './process_manager';
import Machine from './machine';
import { ProcessLogTypes } from '../core/process_log_types';
import { Process as ProcessModel, Process } from '../models/process';
import { ProcessJob as ProcessJobModel } from '../models/process_job';
import { ProcessJobLog as ProcessJobLogModel } from '../models/process_job_log';
import { ProcessCache as ProcessCacheModel } from '../models/process_cache';

export abstract class Job {
    protected processManager: ProcessManager;
    protected machine: Machine;
    protected jobName: string;
    protected processName: string;
    protected processJob: ProcessJobModel | null;
    protected process: Process | null;
    protected cacheResults: { [cacheId: number]: ProcessCacheModel };
    protected cacheTree: { [cacheKey: string]: ProcessCacheModel[] };
    protected loaded: boolean;

    /**
     * Construct our basic job class. Make sure to call job.load() or things will break
     * @param database The database driver we want to use
     * @param processName The name of the process we are trying to utilze
     * @param jobName The job we are trying to target
     * @param machineName The name of the machine we want to tie too
     */
    public constructor(database: Database, processName: string, jobName: string, machineName: string) {
        this.machine = new Machine(database, machineName);
        this.processManager = new ProcessManager(database);
        this.processName = processName;
        this.jobName = jobName;
        this.process = null;
        this.processJob = null;
        this.cacheResults = {};
        this.cacheTree = {};
        this.loaded = false;
    }

    /**
     * Load in any specific data to our process that we should know about
     */
    public load(): Promise<void> {
        return new Promise(
            async (resolve): Promise<void> => {
                if (this.loaded === false) {
                    await this.processManager.load();
                    await this.machine.load();

                    // load our process and our job directly from the process manager making sure that they are created
                    // if they are a new one won't be inserted, the current one will be returned
                    this.process = await this.processManager.createProcess(this.processName);
                    this.processJob = await this.processManager.createJob(this.process, this.jobName);

                    // if we have a cache we are going to pull all the data from it and let inherrited classes manipualte it
                    // otherwise we will signal to our child class that its empty and it needs to be filled if possible
                    let hasCache: boolean = await this.hasCache();
                    if (hasCache) {
                        await this.syncCache();
                        await this.onCacheExist();
                    } else {
                        await this.onCacheEmpty();
                    }
                    this.loaded = true;
                }

                resolve();
            },
        );
    }

    /**
     * When the cache is already present, this method is called for you to manipulate it into any format you need to
     */
    protected abstract onCacheExist(): Promise<void>;
    /**
     * When we have no cache this method will be triggered in load
     */
    protected abstract onCacheEmpty(): Promise<void>;

    protected syncCache(): Promise<void> {
        return new Promise(
            async (resolve): Promise<void> => {
                this.cacheResults = {};
                this.cacheTree = {};
                // build a tree around the results we have so we can access everything locally
                let resultCache = await this.getFullCache();
                for (var i = 0; i < resultCache.length; i++) {
                    if (typeof this.cacheTree[resultCache[i].key] == 'undefined') {
                        this.cacheTree[resultCache[i].key] = [];
                    }

                    this.cacheTree[resultCache[i].key].push(resultCache[i]);
                    this.cacheResults[resultCache[i].id] = resultCache[i];
                }
                resolve();
            },
        );
    }

    /**
     * Log whatever message/value we want. This is functionally a wrapper that calls machine.createLog
     * @param message The message we are trying to log
     * @param logType The kind of log we want to issue
     */
    public createLog(message: string, logType: ProcessLogTypes = ProcessLogTypes.Generic): Promise<ProcessJobLogModel> {
        return this.machine.createLog(
            this.process as ProcessModel,
            this.processJob as ProcessJobModel,
            message,
            logType,
        );
    }

    /**
     * Create a cache value that is tied to this job and machine. This is functionally just a wrapper
     * @param key The key where we want to store it. KEYS ARE NOT UNIQUE, multiple values the share the same relationship should share the same key
     * @param value  The value that we are trying to store it.
     */
    public createCache(key: string, value: string): Promise<ProcessCacheModel> {
        return new Promise((resolve): void => {
            this.machine
                .createCache(this.process as ProcessModel, this.processJob as ProcessJobModel, key, value)
                .then((result: ProcessCacheModel): void => {
                    this.cacheResults[result.id] = result;
                    if (typeof this.cacheTree[result.key] == 'undefined') {
                        this.cacheTree[result.key] = [];
                    }
                    this.cacheTree[result.key].push(result);
                    resolve(result);
                });
        });
    }

    /**
     * Gets the specific values that can be found that match the specific key. This is functionally just a wrapper
     * @param key
     */
    public getCache(key: string): Promise<ProcessCacheModel[]> {
        return this.machine.getCache(this.process as ProcessModel, this.processJob as ProcessJobModel, key);
    }

    /**
     * Determines if a specific key exist in the cache
     * @param key The key to look for
     */
    public hasCacheKey(key: string): Promise<boolean> {
        return this.machine.hasCacheKey(this.process as ProcessModel, this.processJob as ProcessJobModel, key);
    }

    /**
     * Determines if this job has a current cache
     */
    public hasCache(): Promise<boolean> {
        return this.machine.hasCache(this.process as ProcessModel, this.processJob as ProcessJobModel);
    }

    /**
     * Get the full cache tied to this job and process
     */
    public getFullCache(): Promise<ProcessCacheModel[]> {
        return this.machine.getFullCache(this.process as ProcessModel, this.processJob as ProcessJobModel);
    }

    /**
     * Run the job operation. This should be unique to any direct child of this class
     */
    public abstract run(): Promise<void>;
}

export default Job;
