
# Admin - Handling Users in CryoEM-Sweden EMhub 

---

## Users 

In EMhub all users should be first registered in the Application Portal as stated in 
[Booking Guideline]({{ url_for('pages.index', page_id="guidelines", _external=True) }})

There are basically three types of users:

1. Facility staff 
2. Principal investigators
3. Lab members

### Facility staff

These users are **managers** or **admin** in the application and have the rights to
do administrative tasks (eg. create or modify users, make special bookings, 
handle applications, etc)

### Principal investigators 

Principal investigator users are independent researchers that run a lab. In the system they should:

* Have the **admin** role
* Their PI field should be **None** (no one else is their PI)
* Have a non-empty **Invoice reference** field in the portal
* Belong to an existing Application in the Portal/EMhub (also called Bags)

### Lab members

Lab members should basically be associated with a given PI. Then, they will 
inherit the booking rights that their PI has (i.e associated Applications, 
booking slots, resources allocation quota, etc)


## Registering new users

First of all, users need to register in the Application Portal as stated in 
[Booking Guideline]({{ url_for('pages.index', page_id="guidelines", _external=True) }})

Then, we (CryoEM-Sweden staff) should do:

**In the Portal**:

1. Check if it is PI, in which case it should mark **Yes** in the corresponding 
checkbox and provided a non-empty **Invoice Reference** field. 
2. If the user is not a PI, then provide the PI's email in the **Invoice Reference** field.

**In EMhub**:

Import users page can be reached from the left panel in:

ADMIN > Import from Portal > Import Users

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/import_users.png">

If the is an error **error: Missing PI**, it means that the field for the **Invoice Reference** 
of this user is not properly set to a valid email of an existing PI in EMhub. This needs to be 
 fixed in the Application Portal by editing the user information before importing the user.
 
After there are some users for whom their PI has been detected, the "Show Ready Users" button
can be clicked. Then it will show only the list of ready users and the button will change to 
"Import Users (X ready)".

## Adding PIs to an Application
For PI users, one must also check that they belong to an exiting Application and if not, add them.
For adding a PI to an Application, one must open the application and add the PI using its ID in the 
system.

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/adding_pi_application.png">


