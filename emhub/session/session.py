# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

class SessionManager:
    """ Main class that will manage the sessions and their information.
    """
    def get_users(self, condition=None, **attrs):
        pass

    def create_user(self, **attr):
        pass

    def get_sessions(self, condition=None):
        pass

    def create_session(self, sessionId, **attrs):
        pass

    def update_session(self, sessionId, **attrs):
        pass

    def delete_session(self, sessionId):
        pass

    def load_session(self, sessionId):
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
