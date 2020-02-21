

class SessionManager:
    pass


class SessionData:
    """
    Class that will handle the underlying data associate with a given Session.
    It will stores information of the acquisition as well as the pre-processing.
    """

    def getMicrographSets(self, attrsList=None, condition=None, setId=None):
        """ Get a list with all available micrograph sets.

        Args:
            attrsList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            setId: If not None, only the set with that id will be returned
        """
        pass

    def createMicrographSet(self, setId, **attrs):
        """ Create a new set of micrographs.

        Args:
            setId: The id of the new set that will be created.

        Keyword Args:
            Extra attributes that will be set to the set object.

        Return:
            True if the set was successfully created, False otherwise.
        """
        pass

    def getMicrographs(self, setId, attrsList=None, condition=None,
                       itemId=None):
        """ Return the list of all movies of the given set.

        Args:
            setId: The id of the set containing the movies
            attrsList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            itemId: If not None, only the micrograph with that id will be
                returned

        Return:
            A list with micrographs objects.
        """
        pass

    def addMicrograph(self, setId, **attrsDict):
        pass

    def updateMicrograph(self, setId, **attrsDict):
        pass



