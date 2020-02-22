
class SessionManager:
    pass


class SessionData:
    """
    Class that will handle the underlying data associate with a given Session.
    It will store information of the acquisition as well as the pre-processing.
    """

    def get_sets(self, attrList=None, condition=None, setId=None):
        """ Get a list with all available micrograph sets.

        Args:
            attrList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            setId: If not None, only the set with that id will be returned
        """
        pass

    def create_set(self, setId, setType, **attrs):
        """ Create a new set of micrographs.

        Args:
            setId: The id of the new set that will be created.
            setType: The type of the set (Either Movies, Micrographs or Ctfs

        Keyword Args:
            Extra attributes that will be set to the set object.

        Return:
            True if the set was successfully created, False otherwise.
        """
        pass

    def get_items(self, setId, attrList=None, condition=None, itemId=None):
        """ Return the list of all movies of the given set.

        Args:
            setId: The id of the set containing the movies
            attrList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            itemId: If not None, only the micrograph with that id will be
                returned

        Return:
            A list with micrographs objects.
        """
        pass

    def get_item(self, setId, itemId, dataAttrs=None):
        """
        Retrieve the information of a given Micrograph, optionally with
        some images data.

        Args:
            setId: The id of the set where the requested micrograph belongs.
            itemId: The id of the micrograph to be retrieved.
            dataAttrs: Optional list of image data attributes.

        Returns:
            A Micrograph (namedtuple) with the metadata and maybe some
            data attributes (in base64 string format).
        """
        pass

    def add_item(self, setId, itemId, **attrsDict):
        pass

    def update_item(self, setId, itemId, **attrsDict):
        pass
