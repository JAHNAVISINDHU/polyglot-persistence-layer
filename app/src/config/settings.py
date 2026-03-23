from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "logistics"
    postgres_password: str = "logistics_pass"
    postgres_db: str = "logistics_db"

    mongo_uri: str = "mongodb://logistics:logistics_pass@localhost:27017/logistics_db?authSource=admin"
    mongo_db: str = "logistics_db"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "logistics123"

    app_port: int = 3000
    log_level: str = "info"

    log_path: str = "/app/events.log"
    retry_queue_path: str = "/app/retry_queue.json"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
