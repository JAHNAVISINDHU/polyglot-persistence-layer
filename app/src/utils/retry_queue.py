import json
import os
from typing import List, Dict, Any
from src.utils.logger import get_logger

logger = get_logger(__name__)

RETRY_QUEUE_PATH = os.getenv("RETRY_QUEUE_PATH", "/app/retry_queue.json")


def read_queue() -> List[Dict[str, Any]]:
    try:
        if not os.path.exists(RETRY_QUEUE_PATH):
            write_queue([])
            return []
        with open(RETRY_QUEUE_PATH, "r") as f:
            content = f.read().strip()
            if not content:
                return []
            return json.loads(content)
    except Exception as e:
        logger.error(f"Failed to read retry queue: {e}")
        return []


def write_queue(queue: List[Dict[str, Any]]) -> None:
    try:
        with open(RETRY_QUEUE_PATH, "w") as f:
            json.dump(queue, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to write retry queue: {e}")


def enqueue(event: Dict[str, Any]) -> None:
    queue = read_queue()
    exists = any(e.get("invoice_id") == event.get("invoice_id") for e in queue)
    if not exists:
        queue.append(event)
        write_queue(queue)
        logger.info(f"Event added to retry queue: invoice_id={event.get('invoice_id')} package_id={event.get('package_id')}")
    else:
        logger.warning(f"Event already in retry queue, skipping: invoice_id={event.get('invoice_id')}")


def dequeue(invoice_id: str) -> None:
    queue = read_queue()
    new_queue = [e for e in queue if e.get("invoice_id") != invoice_id]
    write_queue(new_queue)


def get_all() -> List[Dict[str, Any]]:
    return read_queue()
