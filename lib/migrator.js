var dbmUtil = require('./util');
var Migration = require('./migration');
var log = require('./log');
var Promise = require('bluebird');
var MigratorInterface = require( './interface/migratorInterface.js');

function SeedLink(driver, internals) {

  this.seeder = require('./seeder.js')(

    driver, internals.argv['vcseeder-dir'], true, internals
  );
  this.links = [];
}
SeedLink.prototype = {

  seed: function( partialName ) {

  },

  link: function( partialName ) {

    this.links.push( partialName );
  },

  process: function() {

    this.clear();
  },

  clear: function() {

    this.links = [];
  }
};

Migrator = function(driver, migrationsDir, empty, intern) {
  this.driver = dbmUtil.reduceToInterface( driver, MigratorInterface );
  this._driver = driver;
  this.migrationsDir = migrationsDir;
  this.internals = intern;

  if(intern.linked === true) {

    this.seedLink = new SeedLink(driver, intern);
  }
  else {

    intern.linked = true;
  }

  this.internals.migrationOptions.relation = require('./relation');

  Migration.exportInternals(intern);
};

Migrator.prototype = {
  createMigrationsTable: function(callback) {
    this._driver.createMigrationsTable(callback);
  },

  writeMigrationRecord: function(migration, callback) {
    function onComplete(err) {
      if (err) {
        log.error(migration.name, err);
      } else {
        log.info('Processed migration', migration.name);
      }
      callback(err);
    }
    this._driver.addMigrationRecord(this.internals.matching + '/' + migration.name, onComplete);
  },

  deleteMigrationRecord: function(migration, callback) {
    function onComplete(err) {
      if (err) {
        log.error(migration.name, err);
      } else {
        log.info('Processed migration', migration.name);
      }
      callback(err);
    }
    this._driver.deleteMigration(this.internals.matching + '/' + migration.name, function(err) {

      if(!this.internals.matching) {

        this._driver.deleteMigration(migration.name, onComplete);
      }
      else {

        onComplete.apply(err);
      }
    }.bind(this));
  },

  up: function(funcOrOpts, callback) {
    if (dbmUtil.isFunction(funcOrOpts)) {
      return funcOrOpts(this.driver, callback);
    } else {
      this.upToBy(funcOrOpts.destination, funcOrOpts.count, callback);
    }
  },

  down: function(funcOrOpts, callback) {
    if (dbmUtil.isFunction(funcOrOpts)) {
      return funcOrOpts(this.driver, callback);
    } else {
      this.downToBy(funcOrOpts.count, callback);
    }
  },

  upToBy: function(partialName, count, callback) {
    var self = this;
    Migration.loadFromFilesystem(self.migrationsDir, self.internals, function(err, allMigrations) {
      if (err) { callback(err); return; }

      Migration.loadFromDatabase(self.migrationsDir, self._driver, self.internals, function(err, completedMigrations) {
        if (err) { callback(err); return; }
        var toRun = dbmUtil.filterUp(allMigrations, completedMigrations, partialName, count);

        if (toRun.length === 0) {
          log.info('No migrations to run');
          callback(null);
          return;
        }

        return Promise.resolve(toRun).each(function(migration) {

          log.verbose('preparing to run up migration:', migration.name);

          return self.driver.startMigration()
          .then(function() {

            var setup = migration.setup();

            if(typeof(setup) === 'function')
              setup(self.internals.migrationOptions, self.seedLink);

            return self.up(migration.up.bind(migration));
          })
          .then(function() {

            if( self.seedLink && self.seedLink.links.length ) {
              log.info('Calling linked seeds');

              return self.seedLink.process();
            }

            return;
          })
          .then(function() {

            return (Promise.promisify(self.writeMigrationRecord.bind(self)))(migration);
          })
          .then(self.driver.endMigration.bind(self.driver));
        })
        .then(function() {
          callback();
        })
        .catch(function(e) {

          throw e;
        });

      });
    });
  },

  downToBy: function(count, callback) {
    var self = this;
    Migration.loadFromDatabase(self.migrationsDir, self._driver, self.internals, function(err, completedMigrations) {
      if (err) { return callback(err); }

      var toRun = dbmUtil.filterDown(completedMigrations, count);

      if (toRun.length === 0) {
        log.info('No migrations to run');
        callback(null);
        return;
      }

      return Promise.resolve(toRun).each(function(migration) {

        log.verbose('preparing to run down migration:', migration.name);

        return self.driver.startMigration()
        .then(function() {
          var setup = migration.setup();

          if(typeof(setup) === 'function')
            setup(self.internals.migrationOptions, self.seedLink);

          return self.down(migration.down.bind(migration));
        })
        .then(function() {

          if( self.seedLink && self.seedLink.links.length ) {
            log.info('Calling linked seeds');

            return self.seedLink.process();
          }

          return;
        })
        .then(function() {
          return (Promise.promisify(self.deleteMigrationRecord.bind(self)))(migration);
        })
        .then(self.driver.endMigration.bind(self.driver));
      })
      .then(function() {
        callback();
      })
      .catch(function(e) {

        throw e;
      });
    });
  }
};

module.exports = Migrator;
