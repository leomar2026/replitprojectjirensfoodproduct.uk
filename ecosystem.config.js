module.exports = {
    apps: [
        {
            name: 'jirens-food-product',
            script: 'server.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'development',
                PORT: 5000
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 5000
            },
            error_file: '/var/log/jirens/error.log',
            out_file: '/var/log/jirens/out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000,
            listen_timeout: 10000
        }
    ]
};
