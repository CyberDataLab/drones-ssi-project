declare global {
    namespace NodeJS {
        interface ProcessEnv {
            DB_PASSWORD: string;
            DB_FILE: string;
        }
    }
}

export {};