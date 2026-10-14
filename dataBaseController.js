import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

export async function initDb(){
    try {
        db = await open({
            filename: 'chat.db',
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sender TEXT,
              target TEXT,
              message TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              isRead BOOLEAN DEFAULT 0,
              file_path TEXT DEFAULT NULL,
              file_type TEXT DEFAULT NULL,
              file_name TEXT DEFAULT NULL
            )
          `);
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err.message);
        process.exit(1);
    }
}

export async function get(command, args){
    return await db.get(command, args);
}

export async function run(command, args){
    return await db.run(command, args);
}

export async function all(command, args){
    return await db.all(command, args);
}

export async function getSequence(name){
    return await db.get(`SELECT seq FROM sqlite_sequence WHERE name = ?`, [name]);
}