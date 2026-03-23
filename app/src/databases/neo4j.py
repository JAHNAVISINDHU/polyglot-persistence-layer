from neo4j import GraphDatabase
from src.config.settings import settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

_driver = None


def get_driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


def connect():
    get_driver().verify_connectivity()
    logger.info("Neo4j connection verified")


def run_query(cypher: str, params: dict = None):
    with get_driver().session() as session:
        result = session.run(cypher, params or {})
        return [record for record in result]


def close():
    global _driver
    if _driver:
        _driver.close()
        _driver = None
        logger.info("Neo4j driver closed")
