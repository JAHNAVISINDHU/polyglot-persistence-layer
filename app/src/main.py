import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from src.databases import postgres, mongo, neo4j
from src.ingestion.log_processor import ingest_log_file
from src.reconciliation.reconciler import run_reconciliation
from src.api.routes import router
from src.utils.logger import get_logger

logger = get_logger(__name__)


def connect_databases(retries: int = 10, delay: int = 5):
    for attempt in range(1, retries + 1):
        try:
            logger.info(f"Connecting to databases (attempt {attempt}/{retries})...")
            postgres.connect()
            mongo.connect()
            neo4j.connect()
            logger.info("All database connections established")
            return
        except Exception as e:
            logger.error(f"Database connection attempt {attempt} failed: {e}")
            if attempt == retries:
                raise
            time.sleep(delay)


def ensure_schema():
    try:
        collection = mongo.get_collection("packages")
        collection.create_index([("package_id", 1)], unique=True)
        logger.info("MongoDB indexes ensured")
    except Exception as e:
        logger.warning(f"Could not create MongoDB index (may already exist): {e}")

    try:
        neo4j.run_query("CREATE CONSTRAINT driver_id IF NOT EXISTS FOR (d:Driver) REQUIRE d.driverId IS UNIQUE")
        neo4j.run_query("CREATE CONSTRAINT zone_id IF NOT EXISTS FOR (z:Zone) REQUIRE z.zoneId IS UNIQUE")
        logger.info("Neo4j constraints ensured")
    except Exception as e:
        logger.warning(f"Could not create Neo4j constraints (may already exist): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting logistics platform...")
    connect_databases()
    ensure_schema()

    logger.info("Starting automatic event ingestion...")
    stats = ingest_log_file()
    logger.info(f"Initial ingestion complete: {stats}")

    logger.info("Running reconciliation pass...")
    run_reconciliation()

    logger.info("API server ready on port 3000")
    yield

    logger.info("Shutting down...")
    postgres.close()
    mongo.close()
    neo4j.close()


app = FastAPI(
    title="Polyglot Logistics Platform",
    description="Real-time logistics platform with polyglot persistence",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(router, prefix="/query")


@app.get("/")
def root():
    return {"service": "logistics-platform", "status": "running", "docs": "/docs"}
