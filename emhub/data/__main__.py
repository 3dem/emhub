
import os

from .data_manager import DataManager


if __name__ == '__main__':

    if not os.path.exists('instance'):
        raise Exception("Please execute the test command from the root of the "
                        "working directory.")

    dbPath = 'instance/emhub.sqlite'

    if os.path.exists(dbPath):
        print("Deleting existing file: ", dbPath)
        os.remove(dbPath)

    DataManager(sqlitePath=dbPath)