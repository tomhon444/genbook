-- Synthetic compatibility fixture only. Not a production migration/schema dump.
CREATE DATABASE t02_central CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE t02_genbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE t02_central;
CREATE TABLE PREFIX (PREFIX_ID VARCHAR(16) PRIMARY KEY, P_SNAME_TH VARCHAR(64) NOT NULL) ENGINE=InnoDB;
CREATE TABLE DEPT (DEPT_ID VARCHAR(32) PRIMARY KEY, DEPT_NAME_TH VARCHAR(255) NOT NULL) ENGINE=InnoDB;
CREATE TABLE POSITION (POSITION_ID VARCHAR(32) PRIMARY KEY, POSITION_NAME VARCHAR(255), POSITION_TYPE CHAR(1), STATUS CHAR(1)) ENGINE=InnoDB;
CREATE TABLE HOLIDAY (H_DATE DATE PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE STAFF_INFO (
 STAFF_ID VARCHAR(64) PRIMARY KEY, LOGIN VARCHAR(100) NOT NULL UNIQUE,
 PASSWORD VARCHAR(255) NOT NULL, ACTIVE CHAR(1) NOT NULL, START_DATE DATE NULL,
 PREFIX_ID VARCHAR(16) NOT NULL, DEPT_ID VARCHAR(32) NOT NULL, POSITION_ID VARCHAR(32),
 FNAME_TH VARCHAR(100) NOT NULL, SNAME_TH VARCHAR(100) NOT NULL,
 KEY ix_fixture_department (DEPT_ID)
) ENGINE=InnoDB;
-- No FK on PREFIX_ID: deliberately missing prefix exercises legacy login rejection.
INSERT INTO PREFIX VALUES ('TEST','Test');
INSERT INTO DEPT VALUES ('T01','Synthetic department one'),('T02','Synthetic department two');
INSERT INTO POSITION VALUES ('TEST','Synthetic position','2','1');
INSERT INTO STAFF_INFO VALUES
 ('T02-OWNER','t02_owner','disabled','1','2026-01-01','TEST','T01','TEST','Synthetic','Owner'),
 ('T02-OTHER','t02_other','disabled','1','2026-01-01','TEST','T02','TEST','Synthetic','Other'),
 ('T02-MANAGER','t02_manager','disabled','1','2026-01-01','TEST','T01','TEST','Synthetic','Manager'),
 ('T02-INACTIVE','t02_inactive','disabled','0','2026-01-01','TEST','T01','TEST','Synthetic','Inactive'),
 ('T02-NOSTART','t02_no_start','disabled','1',NULL,'TEST','T01','TEST','Synthetic','NoStart'),
 ('T02-NOPREFIX','t02_no_prefix','disabled','1','2026-01-01','MISSING','T01','TEST','Synthetic','NoPrefix');
USE t02_genbook;
CREATE TABLE userlevel (iduserlevel INT PRIMARY KEY, staff_id VARCHAR(64) UNIQUE, userlevel VARCHAR(8)) ENGINE=InnoDB;
CREATE TABLE userbook (iduserbook INT PRIMARY KEY, staff_id VARCHAR(64), bookdept_bookdeptid VARCHAR(32), userlevel_iduserlevel VARCHAR(8)) ENGINE=InnoDB;
CREATE TABLE typebook (idtypebook INT PRIMARY KEY, typebook_name VARCHAR(255)) ENGINE=InnoDB;
CREATE TABLE book (idbook INT PRIMARY KEY, book_name VARCHAR(255), status CHAR(1), typebook_idtypebook INT) ENGINE=InnoDB;
CREATE TABLE bookdept (bookdept_id VARCHAR(32) PRIMARY KEY, book_number VARCHAR(255), dept_id VARCHAR(32), book_idbook INT, book_year CHAR(1)) ENGINE=InnoDB;
CREATE TABLE bookdept_user (bookdept_user_id INT PRIMARY KEY, staff_id VARCHAR(64), bookdept_id VARCHAR(32), UNIQUE KEY uq_fixture_grant (staff_id,bookdept_id)) ENGINE=InnoDB;
CREATE TABLE genbook (
 gen_book_id BIGINT PRIMARY KEY, gen_book_year INT, bookdept VARCHAR(32), book_number INT,
 book_number_insert VARCHAR(32), user_request VARCHAR(64), user_dept VARCHAR(32), user_login VARCHAR(64),
 user_datetime DATETIME, date_request DATE, secret CHAR(1), publish CHAR(1), status_genbook CHAR(1)
) ENGINE=InnoDB;
CREATE TABLE genbook_inform (gen_book_id BIGINT, inform VARCHAR(255)) ENGINE=InnoDB;
CREATE TABLE genbook_dept (gen_book_id BIGINT, dept_status CHAR(1), dept VARCHAR(255)) ENGINE=InnoDB;
INSERT INTO typebook VALUES (1,'Synthetic type');
INSERT INTO book VALUES (1,'Synthetic book','1',1);
INSERT INTO bookdept VALUES ('T02-SERIES','TEST ONLY','*',1,'y');
INSERT INTO bookdept_user VALUES (1,'T02-OWNER','T02-SERIES');
INSERT INTO userbook VALUES (1,'T02-MANAGER','T02-SERIES','2');
