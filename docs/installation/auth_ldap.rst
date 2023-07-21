
Authentication with LDAP
========================

.. code-block:: python

    # LDAP server information
    LDAP_HOST = 'ldaps.emhub.org'
    LDAP_PORT = 636
    LDAP_USE_SSL = True
    # LDAP_BIND_AUTHENTICATION_TYPE = 'AUTH_SIMPLE'
    # LDAP_CHECK_NAMES = True

    # The full DN of a user to employ for looking up other users' DNs
    LDAP_BIND_USER_DN = 'CN=ldapbinduser,OU=Service Accounts,OU=SystemUsers,DC=emhub,DC=local'
    # An encrypted version of the bind user's password
    LDAP_BIND_USER_PASSWORD_ENCRYPTED = b'gAAkdjbr9oYayIGETQJb6dttS3P_sdQ8OrCvqeGORTD7l18D3E9cEczmRWxTB1Ik6u-5hwMGY8FpfBmqXMCVv_KQfoHWTk5xvCXc4UnzIAg='

    # A base DN for a node under which all LDAP objects we want to access will
    # be found
    LDAP_BASE_DN = 'OU=SystemUsers,DC=emhub,DC=local'

    # What part of the directory to search for users
    # The user DN prefix is prepended to the base DN to form a DN for the search
    # starting point.
    # LDAP_USER_DN = ''
    # The default scope is 'LEVEL', which searches only objects in the
    # directory node designated by a DN formed from the base and group-specific
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
    LDAP_GROUP_OBJECT_FILTER = '(&(objectclass=group)(!(cn=stjudeUsers)))'






