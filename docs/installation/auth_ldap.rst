
Authentication with LDAP
========================

In EMhub, it is also possible to authenticate users through an external LDAP server.
For that, we need to install the `FlaskLDAP3Login plugin <https://flask-ldap3-login.readthedocs.io/en/latest/>`_:

.. code-block:: bash

    pip install flask-ldap3-login

And in the ``$EMHUB_INSTANCE/config.py`` file:
(This needs to be adjusted for your specific LDAP server)

.. code-block:: python

    # Define the type of authentication used in EMhub
    # Currently only LDAP is supported
    # By default it EMhub will use internal database user/password authentication
    EMHUB_AUTH = 'LDAP'

    # The following LDAP_* variable are only relevant when EMHUB_AUTH = 'LDAP'

    ######################################################
    #
    # For domain authentication via Flask-LDAP3-Login
    #
    ######################################################

    # The remaining properties defined in this secion provide for adapting to
    # the organization's specific directory structure.  They are all used by the
    # flask_ldap3_login package, and described in its documentation.
    #
    # Application logic depends directly on some of the other properties, however,
    # and those are hard-coded.

    # LDAP server information
    LDAP_HOST = 'ldaps.emhub.org'
    LDAP_PORT = 636
    LDAP_USE_SSL = True
    # LDAP_BIND_AUTHENTICATION_TYPE = 'AUTH_SIMPLE'
    # LDAP_CHECK_NAMES = True

    # The full DN of a user to employ for looking up other users' DNs
    LDAP_BIND_USER_DN = 'CN=svcemhubadbind,OU=Service Accounts,OU=SystemUsers,DC=emhub,DC=emh,DC=local'
    # Storing this key here is not secure, but at least it avoids relying
    # on a plaintext password to be recorded on permanent storage
    __key = b'YTfK75LhCZJlXkTy8y9so6Mo1-wkm-pofCtFhyc1i1Y='
    # An encrypted version of the bind user's password
    LDAP_BIND_USER_PASSWORD_ENCRYPTED = b'gAAAAABmM-vrfi9DNY7x6yekuWzP3D6CWxHljb95C6Pp8bQI0sC9TPDWVU0FgYiLZk9RFy_b1s6R-k0fn_0zztxZZdVzs9CXyw=='
    from cryptography.fernet import Fernet
    LDAP_BIND_USER_PASSWORD = str(Fernet(__key).decrypt(LDAP_BIND_USER_PASSWORD_ENCRYPTED), 'utf-8')
    # A base DN for a node under which all LDAP objects we want to access will
    # be found
    LDAP_BASE_DN = 'ou=SystemUsers,dc=emhub,dc=emh,dc=local'

    # What part of the directory to search for users
    # The user DN prefix is prepended to the base DN to form a DN for the search
    # starting point.
    # LDAP_USER_DN = ''
    # The default scope is 'LEVEL', which searches only objects in the
    # directory node deignated by a DN formed from the base and group-specific
    # DN components.  The alternative is 'SUBTREE', which will also search descendant
    # nodes.
    LDAP_USER_SEARCH_SCOPE = 'SUBTREE'
    # A filter to use to identify objects representing system users, and, optionally,
    # to filter out users that should be ignored.  If specified, must be a valid
    # LDAP filter expression.
    # LDAP_USER_OBJECT_FILTER = '(objectclass=person)'

    # What attribute to use to identify a (user) leaf node
    LDAP_USER_RDN_ATTR = 'cn'

    # What attribute to match against the user's provided ID
    # LDAP_USER_LOGIN_ATTRIBUTE = 'uid'
    LDAP_USER_LOGIN_ATTR = 'mail'

    # Should authentication fail if the specified identifier matches multiple users
    # in the search scope?
    LDAP_FAIL_AUTH_ON_MULTIPLE_FOUND = True

    # What part of the directory to search for groups.
    # The group DN prefix is prepended to the base DN to form a DN for the search
    # starting point.
    LDAP_GROUP_DN = 'OU=Hartwell-ID Groups,OU=RI,OU=Departments'
    # The default scope is 'LEVEL', which searches only objects in the
    # directory node deignated by a DN formed from the base and group-specific
    # DN components.  The alternative is 'SUBTREE', which will also search descendant
    # nodes.
    # LDAP_GROUP_SEARCH_SCOPE = 'LEVEL'

    # The group attribute to match against the user's DN to recognize groups to which
    # the user belongs.
    LDAP_GROUP_MEMBERS_ATTR = 'member'

    # A filter to use to identify objects representing system groups, and, optionally,
    # to filter out groups that should be ignored.  If specified, must be a valid
    # LDAP filter expression.
    LDAP_GROUP_OBJECT_FILTER = '(&(objectclass=group)(!(cn=emhubUsers)))'

    LDAP_ADD_SERVER = True
    LDAP_BIND_DIRECT_CREDENTIALS = False
    LDAP_ALWAYS_SEARCH_BIND = True
    LDAP_GET_USER_ATTRIBUTES = [
        # These are not the only attributes available
        'cn',  # Canonical name: 'Doe, John X'
        'department',  # Department: 'Structural Biology'
        'gidNumber',  # Numeric GID of the user's primary group: 99999
        'givenName',  # Personal name: 'John'
        'initials',  # Middle initial(s): 'X'
        'mail',  # Email address: 'John.Doe@EMHUB.ORG'
        'sn',  # Surname: 'Doe'
        'telephoneNumber',  # (work) telephone number: '901-525-1121'
        'title',  # Job title: 'Crash Test Dummy'
        'uid',  # Username: 'jdoe17'
        'uidNumber',  # Numeric user id: 94242
    ]
    LDAP_SEARCH_FOR_GROUPS = True
    LDAP_GET_GROUP_ATTRIBUTES = [
        'cn',  # Canonical name (generally the same as the name)
        'description',  # Description
        'gidNumber',  # Numeric GID of this group
        'name',  # Simple name
    ]
