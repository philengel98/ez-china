import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export class Logger {
    private static readonly LOG_FILE = 'debug.log';

    static async log(message: string) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        
        console.log(logEntry.trim());

        if (Capacitor.getPlatform() === 'web') {
            return;
        }

        try {
            await Filesystem.appendFile({
                path: this.LOG_FILE,
                data: logEntry,
                directory: Directory.Data,  // App-private dir, no external storage permission needed
                encoding: Encoding.UTF8,
            });
        } catch {
            try {
                await Filesystem.writeFile({
                    path: this.LOG_FILE,
                    data: logEntry,
                    directory: Directory.Data,
                    encoding: Encoding.UTF8,
                });
            } catch (err) {
                console.error('Failed to write to log file:', err);
            }
        }
    }

    static async getLogs(): Promise<string> {
        try {
            const result = await Filesystem.readFile({
                path: this.LOG_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            return result.data as string;
        } catch {
            return 'No logs found.';
        }
    }

    static async clearLogs() {
        try {
            await Filesystem.deleteFile({
                path: this.LOG_FILE,
                directory: Directory.Data,
            });
        } catch (e) {
            console.error('Failed to clear logs:', e);
        }
    }
}
